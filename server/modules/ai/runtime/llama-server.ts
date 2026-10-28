// Runs PrismML's llama-server for you: starts it the first time the AI is
// needed, waits until it answers, and stops it after the idle time (to free
// GPU memory) and when the app stops. A llama-server you started yourself is
// used as it is, and never stopped. See docs/architecture.md §12.4.
//
// On Windows, the server can't outlive the app: Node puts child processes in
// a job object that ends them when the app ends, however it ends. Elsewhere
// (macOS, Linux) it can, so the app writes the server's process id to a file;
// after a crash the next start reads it, knows the server is its own, and
// stops it as usual. Windows never uses that file, because there a server
// still answering after a restart can only be someone else's, and a pid can
// belong to another program by then.

import { execFile, execFileSync, spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { AiSettings } from '../../../../shared/contracts/index.ts';
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

    const deadline = Date.now() + config.managed.startTimeoutSec * 1000;
    while (Date.now() < deadline) {
      if (cancelled()) throw stoppedError();
      if (exitCode !== undefined) {
        const message = `llama-server stopped while starting (exit code ${exitCode}). See ${logName}.`;
        state.set('error', message);
        throw new AiUnavailableError(message);
      }
      if (await answers()) {
        if (cancelled()) throw stoppedError();
        state.set('ready');
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    await killPid(proc.pid!, proc);
    forget();
    const message = `llama-server didn't answer at ${healthUrl()} within ${config.managed.startTimeoutSec} seconds. See ${logName}.`;
    state.set('error', message);
    throw new AiUnavailableError(message);
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
    async ensureRunning(signal) {
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
      if (ownedPid === null) return;
      idleTimer = setTimeout(() => void stop(), opts.getConfig().idleMinutes * 60_000);
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

function taskkill(pid: number): Promise<void> {
  return new Promise((done) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => done());
  });
}
