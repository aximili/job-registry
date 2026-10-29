// Runs PrismML's llama-server for you: starts it the first time the AI is
// needed, waits until it answers, and stops it when the app stops, and after
// the idle time if you turned that on (to free GPU memory). A llama-server you started yourself is
// used as it is, and never stopped. See docs/architecture.md §12.4.
//
// On Windows, the server can't outlive the app: Node puts child processes in
// a job object that ends them when the app ends, however it ends. Elsewhere
// (macOS, Linux) it can, so the app writes the server's process id to a file;
// after a crash the next start reads it, knows the server is its own, and
// stops it as usual. Windows never uses that file, because there a server
// still answering after a restart can only be someone else's, and a pid can
// belong to another program by then.
//
// The program can also be a .bat file, such as your own start_bonsai.bat.
// Then the app opens it the way a double-click does, in its own (minimised)
// window, and waits until the AI answers. That window is yours: the app
// never closes it, when idle or when it stops, and background work never
// opens it.

import { execFile, execFileSync, spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { opensWindow, type AiSettings } from '../../../../shared/contracts/index.ts';
import { AiUnavailableError } from '../../../core/errors.ts';
import { runtimeState, type ModelRuntime } from '../runtime.ts';

export type LlamaServerOptions = {
  root: string;
  logFile: string;
  // Where the running server's process id is kept.
  pidFile?: string;
  getConfig: () => AiSettings;
  spawn?: typeof nodeSpawn;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  // Stops the process and everything it started. Windows uses taskkill.
  kill?: (pid: number) => Promise<void>;
  // How long to wait for a stop before forcing it.
  killTimeoutMs?: number;
  // Opens a .bat file in its own window. Windows uses PowerShell.
  openWindow?: (file: string) => Promise<void>;
};

const POLL_MS = 500;
const KILL_GRACE_MS = 5000;
const KILL_TIMEOUT_MS = 10_000;

const stoppedError = () => new DOMException('The AI was stopped.', 'AbortError');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function createLlamaServerRuntime(opts: LlamaServerOptions): ModelRuntime {
  const doFetch = opts.fetch ?? fetch;
  const spawn = opts.spawn ?? nodeSpawn;
  const platform = opts.platform ?? process.platform;
  const killTimeout = opts.killTimeoutMs ?? KILL_TIMEOUT_MS;
  const openWindow = opts.openWindow ?? ((file: string) => openInWindow(file, spawn, platform));
  const pidFile = opts.pidFile ?? resolve(dirname(opts.logFile), '..', 'llama-server.pid');
  const state = runtimeState();
  const logName = relative(opts.root, opts.logFile);

  // The process the app owns: one it spawned (child), or one it found from
  // the pid file after a crash (no child, just the pid).
  let child: ChildProcess | null = null;
  let ownedPid: number | null = null;
  let launched: string | null = null;
  let starting: Promise<void> | null = null;
  let stopping: Promise<void> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  // Goes up on every stop, so a start still in progress knows to give up.
  let generation = 0;

  const healthUrl = () => `${new URL(opts.getConfig().baseUrl).origin}/health`;
  const launchKey = (c: AiSettings) => JSON.stringify({ exe: c.managed.exe, args: c.managed.args, origin: new URL(c.baseUrl).origin });

  async function answers(): Promise<boolean> {
    try {
      const res = await doFetch(healthUrl(), { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  function clearIdle(): void {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }

  function readPidFile(): { pid: number; launch: string } | null {
    try {
      const data = JSON.parse(readFileSync(pidFile, 'utf8')) as { pid?: unknown; launch?: unknown };
      return typeof data.pid === 'number' && typeof data.launch === 'string' ? { pid: data.pid, launch: data.launch } : null;
    } catch {
      return null;
    }
  }

  // Waits until the AI answers, for up to startTimeoutSec. False if it never did.
  async function waitForAnswer(config: AiSettings, cancelled: () => boolean, exited: () => boolean = () => false): Promise<boolean> {
    const deadline = Date.now() + config.managed.startTimeoutSec * 1000;
    while (Date.now() < deadline) {
      if (cancelled()) throw stoppedError();
      if (exited()) return false;
      if (await answers()) {
        if (cancelled()) throw stoppedError();
        return true;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return false;
  }

  function fail(message: string): never {
    state.set('error', message);
    throw new AiUnavailableError(message);
  }

  // Your .bat file, opened in its own window. The app doesn't own what it
  // starts, so it never stops it.
  async function open(config: AiSettings, exe: string, cancelled: () => boolean): Promise<void> {
    const name = basename(exe.replaceAll('\\', '/'));
    if (!existsSync(exe)) fail(`${config.managed.exe} is missing. Check the program in Settings → AI.`);
    state.set('starting');
    try {
      await openWindow(exe);
    } catch (err) {
      fail(`${name} couldn't be opened: ${(err as Error).message}. Check the program in Settings → AI.`);
    }
    if (await waitForAnswer(config, cancelled)) {
      state.set('ready');
      return;
    }
    fail(`The AI didn't answer at ${healthUrl()} within ${config.managed.startTimeoutSec} seconds of opening ${name}. Check the window it opened.`);
  }

  function forget(): void {
    child = null;
    ownedPid = null;
    launched = null;
    rmSync(pidFile, { force: true });
  }

  async function start(gen: number): Promise<void> {
    const config = opts.getConfig();
    const key = launchKey(config);
    const cancelled = () => gen !== generation;

    if (await answers()) {
      if (cancelled()) throw stoppedError();
      // Ours from before a crash, if the pid file says so. Otherwise it's a
      // llama-server you started: use it, never stop it.
      // Only when it was started with these same settings: a pid can be
      // reused by another program after a reboot.
      const left = platform === 'win32' ? null : readPidFile();
      if (left && left.launch === key && alive(left.pid)) {
        ownedPid = left.pid;
        launched = left.launch;
      } else {
        ownedPid = null;
        launched = null;
      }
      state.set('ready');
      return;
    }
    if (cancelled()) throw stoppedError();

    const exe = isAbsolute(config.managed.exe) ? config.managed.exe : resolve(opts.root, config.managed.exe);
    if (opensWindow(exe)) return open(config, exe, cancelled);
    if (!existsSync(exe)) {
      const message = `The AI program isn't installed: ${config.managed.exe} is missing. Run download-ai.bat, or pick another AI in Settings.`;
      state.set('error', message);
      throw new AiUnavailableError(message);
    }

    state.set('starting');
    mkdirSync(dirname(opts.logFile), { recursive: true });
    const log = openSync(opts.logFile, 'a');
    let proc: ChildProcess;
    try {
      writeSync(log, `\n--- Starting llama-server at ${new Date().toISOString()} ---\n`);
      proc = spawn(exe, config.managed.args, { cwd: opts.root, windowsHide: true, stdio: ['ignore', log, log] });
    } catch (err) {
      const message = `llama-server couldn't be started: ${(err as Error).message}. Check the program in Settings.`;
      state.set('error', message);
      throw new AiUnavailableError(message);
    } finally {
      closeSync(log);
    }
    child = proc;
    ownedPid = proc.pid ?? null;
    launched = key;
    if (proc.pid) {
      mkdirSync(dirname(pidFile), { recursive: true });
      writeFileSync(pidFile, JSON.stringify({ pid: proc.pid, launch: key }));
    }

    let exitCode: number | null | undefined;
    proc.on('error', () => {
      exitCode = exitCode ?? -1;
    });
    proc.on('exit', (code, signal) => {
      exitCode = code ?? (signal ? -1 : 0);
      if (child !== proc) return;
      forget();
      clearIdle();
      // A stop we asked for is "off". Anything else, after it was ready, is a crash.
      if (!stopping && state.get() === 'ready') {
        state.set('error', `llama-server stopped unexpectedly (exit code ${exitCode}). See ${logName}.`);
      }
    });

    if (await waitForAnswer(config, cancelled, () => exitCode !== undefined)) {
      state.set('ready');
      return;
    }
    if (exitCode !== undefined) fail(`llama-server stopped while starting (exit code ${exitCode}). See ${logName}.`);
    await killPid(proc.pid!, proc);
    forget();
    fail(`llama-server didn't answer at ${healthUrl()} within ${config.managed.startTimeoutSec} seconds. See ${logName}.`);
  }

  // Waits until the process has gone: its exit event if we spawned it, or
  // polling its pid if we only know the number.
  function gone(pid: number, proc: ChildProcess | null, ms: number): Promise<boolean> {
    if (proc && (proc.exitCode !== null || proc.signalCode !== null)) return Promise.resolve(true);
    return new Promise((done) => {
      const finish = (ok: boolean) => {
        clearInterval(poll);
        clearTimeout(timer);
        proc?.off('exit', onExit);
        done(ok);
      };
      const onExit = () => finish(true);
      proc?.once('exit', onExit);
      const poll = setInterval(() => {
        if (!alive(pid)) finish(true);
      }, 100);
      const timer = setTimeout(() => finish(!alive(pid)), ms);
    });
  }

  async function killPid(pid: number, proc: ChildProcess | null): Promise<void> {
    if (!alive(pid)) return;
    if (platform === 'win32') {
      // /T takes the whole process tree, so nothing is left holding GPU memory.
      void (opts.kill ?? taskkill)(pid).catch(() => undefined);
      if (await gone(pid, proc, killTimeout)) return;
    } else {
      signal(pid, 'SIGTERM');
      if (await gone(pid, proc, Math.min(KILL_GRACE_MS, killTimeout))) return;
    }
    // It didn't go in time: force it, and don't wait any longer.
    signal(pid, 'SIGKILL');
    await gone(pid, proc, 1000);
  }

  function doStop(): Promise<void> {
    generation++;
    clearIdle();
    return (async () => {
      if (starting) await starting.catch(() => undefined);
      const pid = ownedPid;
      const proc = child;
      if (pid !== null) await killPid(pid, proc);
      forget();
      state.set('off');
    })();
  }

  function stop(): Promise<void> {
    stopping ??= doStop().finally(() => {
      stopping = null;
    });
    return stopping;
  }

  return {
    async ensureRunning(signal, o = {}) {
      clearIdle();
      // A stop in progress (the idle timer, a settings change) finishes first.
      if (stopping) await stopping;
      const config = opts.getConfig();
      if (state.get() === 'ready') {
        if (ownedPid !== null && alive(ownedPid)) {
          // Started with other settings: restart it with the new ones.
          if (launched === launchKey(config)) return;
          await stop();
        } else if (ownedPid === null && (await answers())) {
          // A server we only borrowed can go away (you closed it), so check it each time.
          return;
        }
      }
      // Background work only uses a window you (or a task you started) opened.
      if (o.background && opensWindow(config.managed.exe) && !starting) {
        if (await answers()) {
          state.set('ready');
          return;
        }
        state.set('off');
        const name = basename(config.managed.exe.trim().replaceAll('\\', '/'));
        throw new AiUnavailableError(`The AI isn't running. Job Registry opens ${name} when you next save an ad or press Test connection.`);
      }
      const gen = generation;
      starting ??= start(gen).finally(() => {
        starting = null;
      });
      const run = starting;
      if (!signal) return run;
      // A cancelled task stops waiting, but the start carries on for the next one.
      return new Promise<void>((resolveRun, reject) => {
        const onAbort = () => reject(signal.reason ?? stoppedError());
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
        run.then(resolveRun, reject).finally(() => signal.removeEventListener('abort', onAbort));
      });
    },

    touch() {
      clearIdle();
      const config = opts.getConfig();
      if (ownedPid === null || !config.stopWhenIdle) return;
      idleTimer = setTimeout(() => void stop(), config.idleMinutes * 60_000);
      idleTimer.unref?.();
    },

    stop,

    // For a crash or an exit, when there's no time to wait: ends the server
    // the app owns at once.
    stopNow() {
      const pid = ownedPid;
      if (pid === null || !alive(pid)) return;
      try {
        if (platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10_000 });
        }
        else process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      forget();
    },

    state: state.get,
    detail: state.detail,
    onStateChange: state.on,
  };
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // Already gone.
  }
}

// Opens a .bat file the way a double-click does: in a new window, in the
// file's own folder. That window isn't part of the app, so it stays open
// after the app stops. The paths go in through the environment, so no
// quoting can go wrong.
function openInWindow(file: string, spawn: typeof nodeSpawn, platform: NodeJS.Platform): Promise<void> {
  if (platform !== 'win32') return Promise.reject(new Error('a .bat or .cmd file only runs on Windows'));
  return new Promise((done, reject) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:JR_OPEN_FILE -WorkingDirectory $env:JR_OPEN_DIR -WindowStyle Minimized'],
      { env: { ...process.env, JR_OPEN_FILE: file, JR_OPEN_DIR: dirname(file) }, windowsHide: true, stdio: 'ignore' },
    );
    ps.on('error', reject);
    ps.on('exit', (code) => (code === 0 ? done() : reject(new Error(`PowerShell ended with exit code ${code}`))));
  });
}

function taskkill(pid: number): Promise<void> {
  return new Promise((done) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => done());
  });
}
