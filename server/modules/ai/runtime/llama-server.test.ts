import { spawn as realSpawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type AiSettings } from '../../../../shared/contracts/index.ts';
import { startFakeOpenAiServer, type FakeOpenAiServer } from '../../../../tests/fakes/fake-openai-server.ts';
import { createLlamaServerRuntime } from './llama-server.ts';
import type { ModelRuntime } from '../runtime.ts';

const script = fileURLToPath(new URL('../../../../tests/fakes/fake-llama-server.ts', import.meta.url));

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

const answers = async (port: number): Promise<boolean> =>
  fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
    .then((r) => r.ok)
    .catch(() => false);

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

type Setup = { runtime: ModelRuntime; port: number; spawned: ChildProcess[]; root: string; logFile: string };

async function setup(
  overrides: { args?: string[]; rawArgs?: string[]; idleMinutes?: number; stopWhenIdle?: boolean; startTimeoutSec?: number; exe?: string; port?: number } = {},
  extra: { platform?: NodeJS.Platform; kill?: (pid: number) => Promise<void>; fetch?: typeof fetch; root?: string; killTimeoutMs?: number } = {},
): Promise<Setup & { config: AiSettings; again: () => ModelRuntime }> {
  const port = overrides.port ?? (await freePort());
  const root = extra.root ?? mkdtempSync(join(tmpdir(), 'jr-llama-'));
  const logFile = join(root, 'data', 'logs', 'llama.log');
  const spawned: ChildProcess[] = [];
  const config: AiSettings = {
    ...DEFAULT_SETTINGS.ai,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    idleMinutes: overrides.idleMinutes ?? 15,
    stopWhenIdle: overrides.stopWhenIdle ?? true,
    managed: {
      enabled: true,
      exe: overrides.exe ?? process.execPath,
      args: overrides.rawArgs ?? [script, '--port', String(port), ...(overrides.args ?? [])],
      startTimeoutSec: overrides.startTimeoutSec ?? 20,
    },
  };
  // A second runtime on the same folder: the app after a crash and a restart.
  const again = () =>
    createLlamaServerRuntime({
      root,
      logFile,
      pidFile: join(root, 'data', 'llama-server.pid'),
      getConfig: () => config,
      spawn: ((cmd: string, args: string[], opts: object) => {
        const child = realSpawn(cmd, args, opts);
        spawned.push(child);
        return child;
      }) as typeof realSpawn,
      ...extra,
    });
  const runtime = again();
  cleanups.push(async () => {
    await runtime.stop();
    for (const child of spawned) if (child.pid && alive(child.pid)) child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  });
  return { runtime, port, spawned, root, logFile, config, again };
}

describe('llama-server runtime', () => {
  it('starts the process, waits for /health and reports ready', async () => {
    const { runtime, port, logFile } = await setup();
    const states: string[] = [];
    runtime.onStateChange((s) => states.push(s));
    expect(runtime.state()).toBe('off');
    await runtime.ensureRunning();
    expect(runtime.state()).toBe('ready');
    expect(states).toEqual(['starting', 'ready']);
    expect(await answers(port)).toBe(true);
    expect(readFileSync(logFile, 'utf8')).toContain('fake llama-server ready');
  });

  it('two callers during start-up share one start', async () => {
    const { runtime, spawned } = await setup();
    await Promise.all([runtime.ensureRunning(), runtime.ensureRunning()]);
    await runtime.ensureRunning();
    expect(spawned).toHaveLength(1);
  });

  it('uses a server that is already running, and never stops it', async () => {
    const port = await freePort();
    const theirs: FakeOpenAiServer = await startFakeOpenAiServer(undefined, { port });
    cleanups.push(() => theirs.close());
    const { runtime, spawned } = await setup({ port });
    await runtime.ensureRunning();
    expect(spawned).toHaveLength(0);
    expect(runtime.state()).toBe('ready');
    await runtime.stop();
    expect(await answers(port)).toBe(true);
  });

  it('if a server it was using goes away, it starts its own next time', async () => {
    const port = await freePort();
    const theirs = await startFakeOpenAiServer(undefined, { port });
    const { runtime, spawned } = await setup({ port });
    await runtime.ensureRunning();
    await theirs.close();
    await runtime.ensureRunning();
    expect(spawned).toHaveLength(1);
    expect(await answers(port)).toBe(true);
  });

  it('stops after the idle time', async () => {
    const { runtime, port } = await setup({ idleMinutes: 0.005 }); // 300 ms
    await runtime.ensureRunning();
    runtime.touch();
    await new Promise((r) => setTimeout(r, 1500));
    expect(runtime.state()).toBe('off');
    expect(await answers(port)).toBe(false);
  });

  it('with "stop it when it\'s idle" off, it keeps running past the idle time', async () => {
    const { runtime, port } = await setup({ idleMinutes: 0.005, stopWhenIdle: false });
    await runtime.ensureRunning();
    runtime.touch();
    await new Promise((r) => setTimeout(r, 1500));
    expect(runtime.state()).toBe('ready');
    expect(await answers(port)).toBe(true);
  });

  it('stop ends the process, and the port stops answering', async () => {
    const { runtime, port, spawned } = await setup();
    await runtime.ensureRunning();
    await runtime.stop();
    expect(runtime.state()).toBe('off');
    expect(alive(spawned[0]!.pid!)).toBe(false);
    expect(await answers(port)).toBe(false);
  });

  it('a process that dies is reported as an error and started again next time', async () => {
    // It exits 1.2 s after it's ready: longer than one 500 ms health poll.
    const { runtime, spawned, root, logFile } = await setup({ args: ['--exit-after-ms', '1200'] });
    await runtime.ensureRunning();
    await new Promise((r) => setTimeout(r, 1800));
    expect(runtime.state()).toBe('error');
    expect(runtime.detail()).toBe(`llama-server stopped unexpectedly (exit code 3). See ${relative(root, logFile)}.`);
    await runtime.ensureRunning();
    expect(spawned).toHaveLength(2);
  });

  it('a slow start past the limit is killed, with a message naming the log', async () => {
    const { runtime, port, spawned, root, logFile } = await setup({ args: ['--slow-start-ms', '5000'], startTimeoutSec: 1 });
    const err = await runtime.ensureRunning().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `llama-server didn't answer at http://127.0.0.1:${port}/health within 1 seconds. See ${relative(root, logFile)}.`,
    );
    expect(runtime.state()).toBe('error');
    await new Promise((r) => setTimeout(r, 200));
    expect(alive(spawned[0]!.pid!)).toBe(false);
  });

  it('a process that exits while starting says so', async () => {
    const { runtime, root, logFile } = await setup({ rawArgs: ['-e', 'process.exit(4)'] });
    const err = await runtime.ensureRunning().catch((e: unknown) => e);
    expect((err as Error).message).toBe(`llama-server stopped while starting (exit code 4). See ${relative(root, logFile)}.`);
    expect(runtime.state()).toBe('error');
  });

  it('a missing program says how to install it', async () => {
    const { runtime } = await setup({ exe: 'ai/llama.cpp/llama-server.exe' });
    const err = await runtime.ensureRunning().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `The AI program isn't installed: ai/llama.cpp/llama-server.exe is missing. Run download-ai.bat, or pick another AI in Settings.`,
    );
  });

  it('on Windows it stops the whole process tree with taskkill', async () => {
    const killed: number[] = [];
    const { runtime, spawned } = await setup({}, {
      platform: 'win32',
      kill: async (pid) => {
        killed.push(pid);
        process.kill(pid, 'SIGKILL');
      },
    });
    await runtime.ensureRunning();
    await runtime.stop();
    expect(killed).toEqual([spawned[0]!.pid]);
    expect(runtime.state()).toBe('off');
  });

  it('a stop during the first health check starts nothing', async () => {
    const slowRefusal = (async () => {
      await new Promise((r) => setTimeout(r, 300));
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const { runtime, spawned } = await setup({}, { fetch: slowRefusal });
    const starting = runtime.ensureRunning().catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 50));
    await runtime.stop();
    expect(((await starting) as Error).name).toBe('AbortError');
    await new Promise((r) => setTimeout(r, 400));
    expect(spawned).toHaveLength(0);
    expect(runtime.state()).toBe('off');
  });

  it('a stop while it loads kills it and ends "off", not "error"', async () => {
    const { runtime, spawned, port } = await setup({ args: ['--slow-start-ms', '3000'] });
    const starting = runtime.ensureRunning().catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 400));
    await runtime.stop();
    expect(((await starting) as Error).name).toBe('AbortError');
    expect(runtime.state()).toBe('off');
    expect(alive(spawned[0]!.pid!)).toBe(false);
    await new Promise((r) => setTimeout(r, 3000));
    expect(await answers(port)).toBe(false);
  });

  it('a task that arrives while it is stopping waits, then starts it again', async () => {
    const { runtime, spawned } = await setup();
    await runtime.ensureRunning();
    const stopping = runtime.stop();
    await runtime.ensureRunning();
    await stopping;
    expect(spawned).toHaveLength(2);
    expect(runtime.state()).toBe('ready');
    expect(alive(spawned[0]!.pid!)).toBe(false);
  });

  it('a change to the program, arguments or address restarts it at the next task', async () => {
    const { runtime, spawned, config, port } = await setup();
    await runtime.ensureRunning();
    const next = await freePort();
    config.baseUrl = `http://127.0.0.1:${next}/v1`;
    config.managed = { ...config.managed, args: [script, '--port', String(next)] };
    await runtime.ensureRunning();
    expect(spawned).toHaveLength(2);
    expect(await answers(port)).toBe(false);
    expect(await answers(next)).toBe(true);
  });

  it('after the app crashes, the next start still knows the server is its own, and can stop it', async () => {
    const { runtime, spawned, port, again } = await setup();
    await runtime.ensureRunning();
    // The app crashed without stopping it; a new start finds it still running.
    const restarted = again();
    await restarted.ensureRunning();
    expect(spawned).toHaveLength(1);
    await restarted.stop();
    expect(await answers(port)).toBe(false);
    expect(alive(spawned[0]!.pid!)).toBe(false);
  });

  it('on Windows it never adopts a server from the pid file, so it can never stop a stranger', async () => {
    // Windows ends the app's child processes when the app ends, so a server
    // still answering after a restart isn't ours, whatever an old pid file says.
    const killed: number[] = [];
    const { runtime, spawned, port, again } = await setup({}, { platform: 'win32', kill: async (pid) => void killed.push(pid) });
    await runtime.ensureRunning();
    const restarted = again();
    await restarted.ensureRunning();
    await restarted.stop();
    expect(killed).toEqual([]);
    expect(await answers(port)).toBe(true);
    process.kill(spawned[0]!.pid!, 'SIGKILL');
  });

  it('stopNow ends the server at once, for a crash or an exit', async () => {
    const { runtime, spawned } = await setup();
    await runtime.ensureRunning();
    runtime.stopNow();
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(spawned[0]!.pid!)).toBe(false);
  });

  it('if taskkill never returns, stop stops waiting and ends the process anyway', async () => {
    const { runtime, spawned } = await setup({}, { platform: 'win32', kill: () => new Promise(() => {}), killTimeoutMs: 300 });
    await runtime.ensureRunning();
    const started = Date.now();
    await runtime.stop();
    expect(Date.now() - started).toBeLessThan(3000);
    await new Promise((r) => setTimeout(r, 200));
    expect(alive(spawned[0]!.pid!)).toBe(false);
    expect(runtime.state()).toBe('off');
  });

  it('a program Windows refuses to start says so plainly, and never sticks at "starting"', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jr-llama-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const config: AiSettings = { ...DEFAULT_SETTINGS.ai, baseUrl: `http://127.0.0.1:${await freePort()}/v1`, managed: { ...DEFAULT_SETTINGS.ai.managed, exe: process.execPath } };
    const runtime = createLlamaServerRuntime({
      root,
      logFile: join(root, 'data', 'logs', 'llama.log'),
      getConfig: () => config,
      spawn: (() => {
        throw Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' });
      }) as unknown as typeof realSpawn,
    });
    const err = await runtime.ensureRunning().catch((e: unknown) => e);
    expect((err as Error).message).toBe("llama-server couldn't be started: spawn EINVAL. Check the program in Settings.");
    expect(runtime.state()).toBe('error');
  });
});


// Your own start_bonsai.bat as the program: the app opens it in its own
// window, as a double-click does, and never closes that window itself.
describe('llama-server runtime, started with a .bat file', () => {
  async function setupBat(o: { platform?: NodeJS.Platform; spawn?: typeof realSpawn; startTimeoutSec?: number; opens?: 'server' | 'nothing'; file?: string } = {}) {
    const port = await freePort();
    const root = mkdtempSync(join(tmpdir(), 'jr-bat-'));
    const file = o.file ?? join(root, 'Bonsai demo', 'start_bonsai.bat');
    mkdirSync(dirname(file), { recursive: true });
    if (!o.file) writeFileSync(file, '@echo off\r\n');
    const opened: string[] = [];
    let theirs: FakeOpenAiServer | null = null;
    const config: AiSettings = {
      ...DEFAULT_SETTINGS.ai,
      baseUrl: `http://127.0.0.1:${port}/v1`,
      managed: { ...DEFAULT_SETTINGS.ai.managed, exe: file, args: ['-m', 'ignored.gguf'], startTimeoutSec: o.startTimeoutSec ?? 20 },
    };
    // Opening the file starts "Bonsai 2" on the port, as start_bonsai.bat would.
    const openWindow = async (path: string) => {
      opened.push(path);
      if ((o.opens ?? 'server') === 'server') theirs = await startFakeOpenAiServer(undefined, { port });
    };
    const runtime = createLlamaServerRuntime({
      root,
      logFile: join(root, 'data', 'logs', 'llama.log'),
      getConfig: () => config,
      platform: o.platform,
      ...(o.spawn ? { spawn: o.spawn } : { openWindow }),
    });
    cleanups.push(async () => {
      await runtime.stop();
      await theirs?.close();
      rmSync(root, { recursive: true, force: true });
    });
    return { runtime, port, file, opened, config };
  }

  it('opens the file when you need the AI, then waits until it answers', async () => {
    const { runtime, port, file, opened } = await setupBat();
    const states: string[] = [];
    runtime.onStateChange((s) => states.push(s));
    await runtime.ensureRunning();
    expect(opened).toEqual([file]);
    expect(states).toEqual(['starting', 'ready']);
    expect(await answers(port)).toBe(true);
  });

  it('never stops what it opened: not when the app stops, not at once on exit', async () => {
    const { runtime, port } = await setupBat();
    await runtime.ensureRunning();
    runtime.touch();
    await runtime.stop();
    runtime.stopNow();
    expect(await answers(port)).toBe(true);
  });

  it('background work never opens it, so a window never pops up on its own', async () => {
    const { runtime, opened } = await setupBat();
    const err = await runtime.ensureRunning(undefined, { background: true }).catch((e: unknown) => e);
    expect((err as Error).message).toBe('The AI isn\'t running. Job Registry opens start_bonsai.bat when you next save an ad or press Test connection.');
    expect(opened).toEqual([]);
    expect(runtime.state()).toBe('off');
  });

  it('background work uses it once it runs, however it was started', async () => {
    const { runtime, port, opened } = await setupBat();
    const theirs = await startFakeOpenAiServer(undefined, { port });
    cleanups.push(() => theirs.close());
    await runtime.ensureRunning(undefined, { background: true });
    expect(runtime.state()).toBe('ready');
    expect(opened).toEqual([]);
  });

  it('a file that never starts the AI says so, and names the file', async () => {
    const { runtime, port } = await setupBat({ opens: 'nothing', startTimeoutSec: 1 });
    const err = await runtime.ensureRunning().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `The AI didn't answer at http://127.0.0.1:${port}/health within 1 seconds of opening start_bonsai.bat. Check the window it opened.`,
    );
    expect(runtime.state()).toBe('error');
  });

  it('a missing file says which one', async () => {
    const { runtime, opened } = await setupBat({ file: 'D:\\nowhere\\start_bonsai.bat' });
    const err = await runtime.ensureRunning().catch((e: unknown) => e);
    expect((err as Error).message).toBe("D:\\nowhere\\start_bonsai.bat is missing. Check the program in Settings → AI.");
    expect(opened).toEqual([]);
  });

  it('a .bat file only runs on Windows, and it says so elsewhere', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jr-bat-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, 'start.cmd');
    writeFileSync(file, '@echo off\r\n');
    const config: AiSettings = { ...DEFAULT_SETTINGS.ai, baseUrl: `http://127.0.0.1:${await freePort()}/v1`, managed: { ...DEFAULT_SETTINGS.ai.managed, exe: file } };
    const runtime = createLlamaServerRuntime({ root, logFile: join(root, 'llama.log'), getConfig: () => config, platform: 'darwin' });
    const err = await runtime.ensureRunning().catch((e: unknown) => e);
    expect((err as Error).message).toBe("start.cmd couldn't be opened: a .bat or .cmd file only runs on Windows. Check the program in Settings → AI.");
    expect(runtime.state()).toBe('error');
  });

  it('on Windows, PowerShell opens it in its own minimised window, in its own folder', async () => {
    const calls: { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
    let theirs: FakeOpenAiServer | null = null;
    const port = await freePort();
    const spawn = ((cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
      calls.push({ cmd, args, env: opts.env });
      const ps = new EventEmitter();
      void startFakeOpenAiServer(undefined, { port }).then((s) => {
        theirs = s;
        ps.emit('exit', 0, null);
      });
      return ps;
    }) as unknown as typeof realSpawn;
    cleanups.push(async () => {
      await theirs?.close();
    });
    const { runtime, file, config } = await setupBat({ platform: 'win32', spawn });
    config.baseUrl = `http://127.0.0.1:${port}/v1`;
    await runtime.ensureRunning();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe('powershell.exe');
    expect(calls[0]!.args.at(-1)).toBe('Start-Process -FilePath $env:JR_OPEN_FILE -WorkingDirectory $env:JR_OPEN_DIR -WindowStyle Minimized');
    expect(calls[0]!.env.JR_OPEN_FILE).toBe(file);
    expect(calls[0]!.env.JR_OPEN_DIR).toBe(dirname(file));
    expect(runtime.state()).toBe('ready');
  });
});
