// Shared by the Windows handover checks (docs/handover/runbook.md). Each check
// prints PASS, FAIL or INFO lines, keeps them in handover-results\results.txt,
// and ends with exit code 1 when anything failed.
//
// The checks that start and stop the app only ever run on a test copy (by
// default %USERPROFILE%\JobRegistryTest), never on the real app folder, so
// your jobs, settings, profile and secrets are never touched.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REAL_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const IS_WINDOWS = process.platform === 'win32';
const MARKER = '.jr-test-copy';

export const testRoot = (): string => resolve(process.env.JR_TEST_ROOT ?? join(homedir(), 'JobRegistryTest'));
export const testPort = (): number => Number(process.env.JR_TEST_PORT ?? 4787);
export const resultsFile = (): string => process.env.JR_RESULTS ?? join(REAL_ROOT, 'handover-results', 'results.txt');

export type Report = {
  pass(name: string, detail?: string): void;
  fail(name: string, detail: string): void;
  info(name: string, detail?: string): void;
  // Prints the summary, sets the exit code, and returns it.
  finish(): number;
};

const pad = (n: number) => String(n).padStart(2, '0');
function stamp(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Plain ASCII, so the Windows console and Notepad show it as it is.
const ascii = (text: string) => text.replace(/[^ -~]/g, '?');

export function createReport(script: string, o: { resultsFile?: string; print?: (line: string) => void } = {}): Report {
  const file = o.resultsFile ?? resultsFile();
  const print = o.print ?? ((line: string) => console.log(line));
  let failures = 0;
  function line(status: 'PASS' | 'FAIL' | 'INFO', name: string, detail?: string) {
    const text = ascii(detail ? `${status} ${name} - ${detail}` : `${status} ${name}`);
    print(text);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${stamp()} ${script}: ${text}\r\n`);
    if (status === 'FAIL') failures++;
  }
  return {
    pass: (name, detail) => line('PASS', name, detail),
    fail: (name, detail) => line('FAIL', name, detail),
    info: (name, detail) => line('INFO', name, detail),
    finish() {
      const summary = failures > 0 ? `${script}: ${failures} FAIL. Write each FAIL in handover-results\\bugs\\.` : `${script}: all PASS.`;
      print(summary);
      appendFileSync(file, `${stamp()} ${script}: ${summary}\r\n`);
      process.exitCode = failures > 0 ? 1 : 0;
      return failures > 0 ? 1 : 0;
    },
  };
}

// What the test copy leaves out: your data, settings, secrets, profile and
// templates, the 8 GB AI, and anything that's built or downloaded again.
const LEFT_OUT = [
  'data',
  'profile',
  'templates',
  'ai',
  'node_modules',
  'web/dist',
  'extension/dist',
  'web-ext-artifacts',
  'test-results',
  'playwright-report',
  'handover-results',
  '.superpowers',
];

export function keepInTestCopy(rel: string): boolean {
  const path = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  // From config\ only the example: never your settings, your secrets, or a half-written copy of either.
  if (path.startsWith('config/')) return path === 'config/settings.example.json';
  return !LEFT_OUT.some((out) => path === out || path.startsWith(`${out}/`));
}

// Empties a test copy made before, or makes the folder. A folder with other
// things in it is never deleted.
const MARKER_TEXT = 'Made by the Job Registry handover checks. Safe to delete.\r\n';

export function prepareTestRoot(dir: string): void {
  if (existsSync(dir)) {
    if (existsSync(join(dir, MARKER))) {
      // Everything but the marker first, so a locked file (a running copy,
      // a virus scan) leaves the folder still marked as ours for next time.
      try {
        for (const name of readdirSync(dir)) {
          if (name !== MARKER) rmSync(join(dir, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        }
      } catch (err) {
        writeFileSync(join(dir, MARKER), MARKER_TEXT);
        throw new Error(`Couldn't empty the old test copy in ${dir}: ${(err as Error).message}`);
      }
    } else if (readdirSync(dir).length > 0) {
      throw new Error(`${dir} wasn't made by the handover checks, so it's left alone. Move it, or set JR_TEST_ROOT to another folder.`);
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MARKER), MARKER_TEXT);
}

export function isTestCopy(dir: string): boolean {
  return existsSync(join(dir, MARKER)) && resolve(dir) !== REAL_ROOT;
}

// The test copy's settings: its own port, no email, and an AI address where
// nothing listens, so it never uses the Bonsai 2 the agent is running on. The
// AI check gives it its own llama-server on another port instead.
export function testSettings(o: { port: number; llama?: { exe: string; model: string; port: number } }): object {
  const ai = o.llama
    ? {
        preset: 'llama-server',
        baseUrl: `http://127.0.0.1:${o.llama.port}/v1`,
        idleMinutes: 1,
        managed: {
          enabled: true,
          exe: o.llama.exe,
          args: ['-m', o.llama.model, '-ngl', '99', '-fa', 'on', '-c', '16384', '--jinja', '--port', String(o.llama.port)],
          startTimeoutSec: 240,
        },
      }
    : { preset: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'none' };
  return { server: { port: o.port }, ai, email: { enabled: false } };
}

export function writeTestSettings(root: string, settings: object): void {
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
}

export const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(check: () => Promise<boolean> | boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await check()) return true;
    } catch {
      // Not yet.
    }
    if (Date.now() > end) return false;
    await sleep(500);
  }
}

// The app's API on a port. Writes carry the dashboard's Origin, as the dashboard does.
export async function api(port: number, method: string, path: string, body?: unknown, timeoutMs = 30_000) {
  const origin = `http://127.0.0.1:${port}`;
  const res = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: method === 'GET' ? {} : { origin, 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, type: res.headers.get('content-type') ?? '' };
}

// Anything at all answering on a port (even a 404) means it isn't free.
export async function portAnswers(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

export async function healthy(port: number): Promise<boolean> {
  try {
    return (await api(port, 'GET', '/health', undefined, 2_000)).json?.ok === true;
  } catch {
    return false;
  }
}

// A request with any Host header (fetch can't set one).
export function statusWithHost(port: number, host: string, path = '/api/v1/health'): Promise<number> {
  return new Promise((resolveStatus) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host }, timeout: 5_000 }, (res) => {
      res.resume();
      resolveStatus(res.statusCode ?? 0);
    });
    req.on('error', () => resolveStatus(0));
    req.on('timeout', () => req.destroy());
    req.end();
  });
}

export type RunResult = { status: number | null; stdout: string; stderr: string };

// Output goes to files, not pipes: a server that start.bat starts inherits
// them, and a pipe would keep us waiting until that server stopped.
function runAndRead(file: string, args: string[], o: { cwd: string; timeoutMs: number; shell?: boolean }): RunResult {
  const dir = mkdtempSync(join(tmpdir(), 'jr-run-'));
  const outFile = join(dir, 'out.txt');
  const errFile = join(dir, 'err.txt');
  const out = openSync(outFile, 'w');
  const err = openSync(errFile, 'w');
  let status: number | null = null;
  try {
    status = spawnSync(file, args, { cwd: o.cwd, stdio: ['ignore', out, err], timeout: o.timeoutMs, shell: o.shell, windowsHide: true }).status;
  } finally {
    closeSync(out);
    closeSync(err);
  }
  const result = { status, stdout: readFileSync(outFile, 'utf8'), stderr: readFileSync(errFile, 'utf8') };
  // A server it started may still hold the files open; the temp folder is left then.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    // Still open: Windows cleans its temp folder later.
  }
  return result;
}

// Runs a .bat file the way you would, with nothing to type (so a "pause" goes straight on).
export function runBat(root: string, bat: string, args: string[] = [], timeoutMs = 600_000): RunResult {
  return runAndRead('cmd.exe', ['/d', '/c', bat, ...args], { cwd: root, timeoutMs });
}

// Runs one command line in the shell (cmd on Windows), for npm, npx, git and nvidia-smi.
export function runCommand(command: string, cwd: string, timeoutMs = 600_000): RunResult {
  return runAndRead(command, [], { cwd, timeoutMs, shell: true });
}

// Ends whatever listens on these ports (the test copy's, its llama-server's,
// and the browser tests'), with any programs it started. Never the real
// app's port or the agent's Bonsai 2. Returns the ports it freed.
export function killPortListeners(ports: number[]): number[] {
  const freed: number[] = [];
  for (const port of ports) {
    const pids = listenerPids(port);
    for (const pid of pids) {
      if (IS_WINDOWS) spawnSync('taskkill', ['/T', '/F', '/PID', pid], { stdio: 'ignore' });
      else {
        try {
          process.kill(Number(pid), 'SIGTERM');
        } catch {
          // Already gone.
        }
      }
    }
    if (pids.length > 0) freed.push(port);
  }
  return freed;
}

// The ids of the processes listening on a port.
export function listenerPids(port: number): string[] {
  let pids: string[] = [];
  if (IS_WINDOWS) {
    const out = runCommand('netstat -ano -p tcp', REAL_ROOT, 30_000).stdout;
    pids = out
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/))
      // TCP  127.0.0.1:4787  0.0.0.0:0  LISTENING  1234 (the state word is translated on some Windows).
      .filter((cols) => cols.length >= 5 && /:(\d+)$/.exec(cols[1] ?? '')?.[1] === String(port) && /^(0\.0\.0\.0|\[::\]):0$/.test(cols[2] ?? ''))
      .map((cols) => cols.at(-1)!)
      .filter((pid) => /^\d+$/.test(pid) && pid !== '0');
  } else {
    pids = (spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).stdout ?? '').split(/\s+/).filter(Boolean);
  }
  return [...new Set(pids)];
}

// Starts the app in a folder: start.bat on Windows, node directly elsewhere.
export function startApp(root: string): { code: number | null; output: string } {
  if (IS_WINDOWS) {
    const res = runBat(root, 'start.bat', ['--no-browser'], 120_000);
    return { code: res.status, output: `${res.stdout}${res.stderr}` };
  }
  const child = spawn(process.execPath, ['server/main.ts'], { cwd: root, detached: true, stdio: 'ignore' });
  child.unref();
  return { code: 0, output: '' };
}

// Stops the app in a folder: stop.bat on Windows, the same request elsewhere.
export async function stopApp(root: string, port: number): Promise<string> {
  if (IS_WINDOWS) {
    const res = runBat(root, 'stop.bat', [], 60_000);
    return `${res.stdout}${res.stderr}`;
  }
  try {
    await api(port, 'POST', '/system/shutdown', {}, 5_000);
    return 'Job Registry stopped.';
  } catch {
    return "Job Registry wasn't running.";
  }
}
