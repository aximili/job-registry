// The Windows handover checks (scripts/handover/). Their logic and their
// HTTP checks run here; the .bat files and Windows processes only on the PC.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, Settings } from '../shared/contracts/index.ts';
import { createServer, type RequestListener } from 'node:http';
import { appAi, createReport, findFirefox, keepInTestCopy, killPortListeners, prepareTestRoot, testSettings } from '../scripts/handover/lib.ts';
import { freePort } from './helpers/test-app.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'jr-handover-'));
  dirs.push(dir);
  return dir;
};

// Your own settings, for a check that reads them, in a temp file.
const realSettings = (settings: object) => {
  const file = join(temp(), 'settings.json');
  writeFileSync(file, JSON.stringify(settings));
  return file;
};

// Runs a check without blocking, so a server in this process can answer it.
const runScript = (script: string, env: NodeJS.ProcessEnv) =>
  new Promise<string>((resolveOut) => {
    const child = spawn(process.execPath, [`scripts/handover/${script}`], { env });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', () => resolveOut(out));
  });

const listen = async (handler: RequestListener) => {
  const port = await freePort();
  const server = createServer(handler).listen(port, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return { port, close: () => new Promise((r) => server.close(r)) };
};

describe('handover: the report', () => {
  it('prints PASS, FAIL and INFO lines, keeps them in the results file, and fails when anything failed', () => {
    const file = join(temp(), 'results.txt');
    const out: string[] = [];
    const report = createReport('demo', { resultsFile: file, print: (line) => out.push(line) });
    report.pass('one thing works');
    report.info('a note', 'detail');
    report.fail('another thing', 'what went wrong');
    expect(out).toEqual(['PASS one thing works', 'INFO a note - detail', 'FAIL another thing - what went wrong']);
    expect(report.finish()).toBe(1);
    expect(out.at(-1)).toBe('demo: 1 FAIL. Write each FAIL in handover-results\\bugs\\.');
    const saved = readFileSync(file, 'utf8');
    expect(saved).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} demo: PASS one thing works$/m);
    expect(saved).toContain('demo: FAIL another thing - what went wrong');
    expect(saved).toContain('demo: 1 FAIL. Write each FAIL in handover-results\\bugs\\.');
    expect([...saved].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });

  it('finishes with 0 when everything passed', () => {
    const out: string[] = [];
    const report = createReport('demo', { resultsFile: join(temp(), 'r.txt'), print: (l) => out.push(l) });
    report.pass('fine');
    expect(report.finish()).toBe(0);
    expect(out.at(-1)).toBe('demo: all PASS.');
  });
});

describe('handover: the test copy', () => {
  it.each([
    ['package.json', true],
    ['server/main.ts', true],
    ['.git/HEAD', true],
    ['config/settings.example.json', true],
    ['data', false],
    ['data/jobs.db', false],
    ['config/settings.json', false],
    ['config/secrets.json', false],
    ['profile/master-profile.md', false],
    ['templates/resume.css', false],
    ['ai/models/Ternary-Bonsai-2-27B-PQ2_0.gguf', false],
    ['node_modules/zod/package.json', false],
    ['web/dist/index.html', false],
    ['extension/dist/firefox/manifest.json', false],
    ['handover-results/results.txt', false],
    ['.superpowers/sdd/x.md', false],
    ['starters/profile/resume-guide.md', true],
    ['config/secrets.json.tmp', false],
    ['config/settings.json.tmp', false],
    ['config/anything-else.json', false],
  ])('%s is copied: %s', (rel, kept) => {
    expect(keepInTestCopy(rel)).toBe(kept);
    expect(keepInTestCopy(rel.replace(/\//g, '\\'))).toBe(kept);
  });

  it('never deletes a folder it did not make', () => {
    const dir = temp();
    writeFileSync(join(dir, 'something.txt'), 'yours');
    expect(() => prepareTestRoot(dir)).toThrow(/wasn't made by the handover checks/);
    expect(existsSync(join(dir, 'something.txt'))).toBe(true);
  });

  // The delete retries for about 7 seconds, as a lock on Windows often clears.
  it('keeps its marker when a file in the old copy is locked, so the next run can try again', { timeout: 30_000 }, () => {
    const dir = join(temp(), 'copy');
    prepareTestRoot(dir);
    const locked = join(dir, 'zz-locked');
    mkdirSync(locked);
    writeFileSync(join(locked, 'file.txt'), 'x');
    chmodSync(locked, 0o500);
    try {
      expect(() => prepareTestRoot(dir)).toThrow();
      expect(existsSync(join(dir, '.jr-test-copy'))).toBe(true);
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  it('empties a test copy it made before, and makes a new one', () => {
    const dir = join(temp(), 'copy');
    prepareTestRoot(dir);
    writeFileSync(join(dir, 'old.txt'), 'old');
    prepareTestRoot(dir);
    expect(existsSync(join(dir, 'old.txt'))).toBe(false);
    expect(existsSync(join(dir, '.jr-test-copy'))).toBe(true);
  });

  it('test settings use their own port, and an AI address where nothing listens', () => {
    const s = Settings.parse(testSettings({ port: 4787 }));
    expect(s.server.port).toBe(4787);
    expect(s.ai).toMatchObject({ preset: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'none' });
    expect(s.email.enabled).toBe(false);
  });

  it('test settings for the AI check run their own llama-server on 8081, from the real ai folder', () => {
    const s = Settings.parse(
      testSettings({ port: 4787, llama: { exe: 'C:\\JR\\ai\\llama.cpp\\llama-server.exe', model: 'C:\\JR\\ai\\models\\m.gguf', port: 8081 } }),
    );
    expect(s.ai).toMatchObject({ preset: 'llama-server', baseUrl: 'http://127.0.0.1:8081/v1', idleMinutes: 1 });
    expect(s.ai.managed).toMatchObject({ enabled: true, exe: 'C:\\JR\\ai\\llama.cpp\\llama-server.exe', startTimeoutSec: 240 });
    expect(s.ai.managed.args).toEqual(['-m', 'C:\\JR\\ai\\models\\m.gguf', '-ngl', '99', '-fa', 'on', '-c', '16384', '--jinja', '--port', '8081']);
  });

  it('test settings for the AI check can use the AI server you run yourself, as your settings do', () => {
    const yours = Settings.parse({ ai: { preset: 'custom', baseUrl: 'http://127.0.0.1:8080/v1', model: 'bonsai-2', tasks: { write: { maxTokens: 6000 } } } }).ai;
    const s = Settings.parse(testSettings({ port: 4787, external: yours }));
    expect(s.server.port).toBe(4787);
    expect(s.ai).toEqual(yours);
    expect(s.email.enabled).toBe(false);
  });
});

describe('handover: which AI your settings use', () => {
  it('a server you run yourself: another preset, or llama-server that the app does not start', () => {
    const custom = Settings.parse({ ai: { preset: 'custom', baseUrl: 'http://127.0.0.1:8080/v1', model: 'bonsai-2' } }).ai;
    expect(appAi(custom, '/app')).toEqual({ kind: 'external', baseUrl: 'http://127.0.0.1:8080/v1' });
    const ollama = Settings.parse({ ai: { preset: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' } }).ai;
    expect(appAi(ollama, '/app')).toEqual({ kind: 'external', baseUrl: 'http://127.0.0.1:11434/v1' });
    const unmanaged = Settings.parse({ ai: { managed: { enabled: false } } }).ai;
    expect(appAi(unmanaged, '/app')).toEqual({ kind: 'external', baseUrl: 'http://127.0.0.1:8080/v1' });
  });

  it('Bonsai 2 started by the app: its program and model, from the app folder or anywhere else', () => {
    expect(appAi(DEFAULT_SETTINGS.ai, '/app')).toEqual({
      kind: 'managed',
      exe: resolve('/app', 'ai/llama.cpp/llama-server.exe'),
      model: resolve('/app', 'ai/models/Ternary-Bonsai-2-27B-PQ2_0.gguf'),
    });
    const elsewhere = Settings.parse({ ai: { managed: { exe: '/aitest/llama-server', args: ['--model', '/aitest/bonsai.gguf', '--port', '8080'] } } }).ai;
    expect(appAi(elsewhere, '/app')).toEqual({ kind: 'managed', exe: '/aitest/llama-server', model: '/aitest/bonsai.gguf' });
    const noModel = Settings.parse({ ai: { managed: { args: ['--port', '8080'] } } }).ai;
    expect(appAi(noModel, '/app')).toMatchObject({ kind: 'managed', model: null });
  });
});

describe('handover: finding Firefox', () => {
  it('finds it in Program Files, installed just for you, or from the Microsoft Store', () => {
    const base = temp();
    const env = { ProgramFiles: join(base, 'pf'), 'ProgramFiles(x86)': join(base, 'pf86'), LOCALAPPDATA: join(base, 'local') };
    const place = (...parts: string[]) => {
      mkdirSync(join(base, ...parts.slice(0, -1)), { recursive: true });
      writeFileSync(join(base, ...parts), '');
      return join(base, ...parts);
    };
    expect(findFirefox(env)).toBeNull();
    // The Store's app links, as on the PC (the package's folder, then the short link).
    const store = join(base, 'local', 'Microsoft', 'WindowsApps');
    mkdirSync(join(store, 'Mozilla.Firefox_n80bbvh6b1yt2'), { recursive: true });
    expect(findFirefox(env)).toBe(join(store, 'Mozilla.Firefox_n80bbvh6b1yt2', 'firefox.exe'));
    // Each place is found ahead of the ones before it.
    for (const parts of [
      ['local', 'Microsoft', 'WindowsApps', 'firefox.exe'],
      ['local', 'Mozilla Firefox', 'firefox.exe'],
      ['pf86', 'Mozilla Firefox', 'firefox.exe'],
      ['pf', 'Mozilla Firefox', 'firefox.exe'],
    ]) {
      const file = place(...parts);
      expect(findFirefox(env)).toBe(file);
    }
  });
});

describe('handover: cleaning up', () => {
  it('ends whatever is left listening on a test port', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ['-e', `require('node:http').createServer((q, r) => r.end('x')).listen(${port}, '127.0.0.1')`], { stdio: 'ignore' });
    const up = async () => fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false);
    for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
    expect(await up()).toBe(true);
    expect(killPortListeners([port])).toEqual([port]);
    for (let i = 0; i < 40 && (await up()); i++) await new Promise((r) => setTimeout(r, 100));
    expect(await up()).toBe(false);
    child.kill();
  });
});

describe('handover: the summary', () => {
  it('counts each check from results.txt and picks out the times', () => {
    const base = temp();
    const results = join(base, 'results.txt');
    writeFileSync(results, [
      '2026-11-02 10:00:00 prereqs: PASS Node.js 24 or later',
      '2026-11-02 10:00:01 prereqs: prereqs: all PASS.',
      '2026-11-02 10:05:00 ai-smoke: PASS the AI reads a saved ad - 14 s (the plan\'s goal is about 20 s); role "A", company "B"',
      '2026-11-02 10:06:00 ai-smoke: FAIL the graphics memory comes back - 9000 MiB before, 9000 MiB after',
      '2026-11-02 10:07:00 ai-smoke: PASS the AI writes a resume - 95 s, 3000 characters',
      '2026-11-02 10:07:01 ai-smoke: ai-smoke: 1 FAIL. Write each FAIL in handover-results\\bugs\\.',
      '',
    ].join('\r\n'));
    mkdirSync(join(base, 'bugs'));
    writeFileSync(join(base, 'bugs', 'bug-01.md'), '## Bug 1: The graphics memory stays in use\n');
    const res = spawnSync(process.execPath, ['scripts/handover/summary.ts'], { env: { ...process.env, JR_RESULTS: results }, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    const summary = readFileSync(join(base, 'summary.md'), 'utf8');
    expect(summary).toContain('- prereqs: all PASS');
    expect(summary).toContain('- ai-smoke: 1 FAIL');
    expect(summary).toContain('- Reading an ad: 14 s');
    expect(summary).toContain('- Writing a resume: 95 s');
    expect(summary).toContain('1 bug:');
    expect(summary).toContain('- bug-01.md: The graphics memory stays in use');
  });

  it('says which AI the AI check used', () => {
    const base = temp();
    const results = join(base, 'results.txt');
    writeFileSync(results, '2026-11-02 10:05:00 ai-smoke: INFO the AI used - your own AI server at http://127.0.0.1:8080/v1\r\n');
    const res = spawnSync(process.execPath, ['scripts/handover/summary.ts'], { env: { ...process.env, JR_RESULTS: results }, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(readFileSync(join(base, 'summary.md'), 'utf8')).toContain('- The AI check used: your own AI server at http://127.0.0.1:8080/v1');
  });
});

describe.skipIf(process.platform === 'win32')('handover: the app smoke check, run for real against a test copy', () => {
  it('starts the app, checks it, and stops it, with every line PASS', { timeout: 120_000 }, () => {
    const base = temp();
    const root = join(base, 'copy');
    const results = join(base, 'results.txt');
    const env = { ...process.env, JR_TEST_ROOT: root, JR_RESULTS: results, JR_TEST_PORT: '4789' };
    const made = spawnSync(process.execPath, ['scripts/handover/make-test-copy.ts', '--link-modules'], { env, encoding: 'utf8' });
    expect(made.status, made.stdout + made.stderr).toBe(0);
    expect(existsSync(join(root, 'data'))).toBe(false);
    mkdirSync(join(root, 'data'), { recursive: true });

    const smoke = spawnSync(process.execPath, ['scripts/handover/app-smoke.ts'], { env, encoding: 'utf8', timeout: 100_000 });
    const out = smoke.stdout + smoke.stderr;
    expect(smoke.status, out).toBe(0);
    for (const check of [
      'PASS the app starts',
      'PASS health answers',
      'PASS the dashboard is served',
      'PASS a request for another host name is refused',
      'PASS a write from another website is refused',
      'PASS a backup is made',
      'PASS a job is saved and found by search',
      'PASS the starter guides and templates are copied in',
      'PASS a job is found by part of a phone number in under 2 seconds',
      'PASS a job saved while the AI is off waits, and says why',
      'PASS a file with an accented name is attached, and downloads with its name',
      'PASS backups copy attached files',
      'PASS backups copy your profile and templates',
      'PASS a file over 15 MB is refused, with a plain message',
      'PASS a guide edited on disk shows in the app',
      'PASS a phone number written another way finds the job',
      'PASS the app stops',
      'PASS a broken settings file stops the app with a plain message',
    ]) {
      expect(out).toContain(check);
    }
    expect(out).not.toContain('FAIL');
    expect(readFileSync(results, 'utf8')).toContain('app-smoke: PASS the app stops');
  });
});

describe.skipIf(process.platform === 'win32')('handover: the AI check, run against the fake llama-server', () => {
  it('starts llama-server through the app, reads an ad, and stops it with the app', { timeout: 150_000 }, () => {
    const base = temp();
    const root = join(base, 'copy');
    const env = {
      ...process.env,
      JR_TEST_ROOT: root,
      JR_RESULTS: join(base, 'results.txt'),
      JR_TEST_PORT: '4790',
      JR_LLAMA_PORT: '8093',
      JR_LLAMA_EXE: process.execPath,
      JR_LLAMA_ARGS: JSON.stringify([join(process.cwd(), 'tests', 'fakes', 'fake-llama-server.ts'), '--port', '8093', '--smart']),
    };
    const made = spawnSync(process.execPath, ['scripts/handover/make-test-copy.ts', '--link-modules'], { env, encoding: 'utf8' });
    expect(made.status, made.stdout + made.stderr).toBe(0);
    const ai = spawnSync(process.execPath, ['scripts/handover/ai-smoke.ts', '--no-idle'], { env, encoding: 'utf8', timeout: 140_000 });
    const out = ai.stdout + ai.stderr;
    expect(ai.status, out).toBe(0);
    for (const check of [
      'PASS the app starts',
      'PASS the app starts llama-server and the AI answers',
      'PASS llama-server answers on port 8093',
      'PASS the AI reads a saved ad',
      'PASS the AI writes a resume',
      'PASS no thinking text in the resume',
      'PASS the resume exports as a .docx file',
      'PASS stopping the app stops llama-server too',
      "PASS a llama-server the app didn't start is left running",
      'PASS the AI rates a job against the profile',
    ]) {
      expect(out).toContain(check);
    }
    expect(out).toContain('INFO the idle stop is skipped');
    expect(out).not.toContain('FAIL');

    // The reading-quality report, run in the same test copy, lands in the results folder.
    const report = spawnSync(process.execPath, ['scripts/handover/eval-report.ts'], { env, encoding: 'utf8', timeout: 120_000 });
    expect(report.status, report.stdout + report.stderr).toBe(0);
    expect(readFileSync(join(base, 'eval-report.txt'), 'utf8')).toMatch(/title/i);
  });

  // As on the PC: your settings point at your own Bonsai 2, and ai\ is empty.
  it('uses the AI server your settings point at, and leaves it running', { timeout: 150_000 }, async () => {
    const base = temp();
    const root = join(base, 'copy');
    const aiPort = await freePort();
    const yours = spawn(process.execPath, [join('tests', 'fakes', 'fake-llama-server.ts'), '--port', String(aiPort), '--smart'], { stdio: 'ignore' });
    const up = () => fetch(`http://127.0.0.1:${aiPort}/health`).then((r) => r.ok, () => false);
    try {
      for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
      const env = {
        ...process.env,
        JR_TEST_ROOT: root,
        JR_RESULTS: join(base, 'results.txt'),
        JR_TEST_PORT: '4792',
        JR_REAL_SETTINGS: realSettings({ ai: { preset: 'custom', baseUrl: `http://127.0.0.1:${aiPort}/v1`, model: 'bonsai-2' } }),
      };
      const made = spawnSync(process.execPath, ['scripts/handover/make-test-copy.ts', '--link-modules'], { env, encoding: 'utf8' });
      expect(made.status, made.stdout + made.stderr).toBe(0);
      const out = await runScript('ai-smoke.ts', env);
      for (const check of [
        `INFO the AI used - your own AI server at http://127.0.0.1:${aiPort}/v1`,
        'PASS your AI server answers',
        'PASS the app starts',
        'PASS the app reaches your AI server and it answers',
        'PASS the AI reads a saved ad',
        'PASS the AI rates a job against the profile',
        'PASS the AI writes a resume',
        'PASS no thinking text in the resume',
        'PASS the resume exports as a .docx file',
        'PASS stopping the app leaves your AI server running',
        'ai-smoke: all PASS.',
      ]) {
        expect(out).toContain(check);
      }
      expect(out).not.toContain('FAIL');
      expect(out).not.toContain('llama-server answers on port');
      expect(await up()).toBe(true);
    } finally {
      yours.kill();
    }
  });

  it('says plainly when your AI server does not answer', { timeout: 60_000 }, async () => {
    const base = temp();
    const root = join(base, 'copy');
    const nothing = await freePort();
    const env = {
      ...process.env,
      JR_TEST_ROOT: root,
      JR_RESULTS: join(base, 'results.txt'),
      JR_TEST_PORT: '4793',
      JR_REAL_SETTINGS: realSettings({ ai: { preset: 'custom', baseUrl: `http://127.0.0.1:${nothing}/v1`, model: 'bonsai-2' } }),
    };
    const made = spawnSync(process.execPath, ['scripts/handover/make-test-copy.ts', '--link-modules'], { env, encoding: 'utf8' });
    expect(made.status, made.stdout + made.stderr).toBe(0);
    const out = await runScript('ai-smoke.ts', env);
    expect(out).toContain(`FAIL your AI server answers - nothing answers at http://127.0.0.1:${nothing}/v1.`);
    expect(out).toContain('ai-smoke: 1 FAIL.');
  });
});

describe("handover: your settings' AI, in the first check", () => {
  const prereqs = (settings: object) =>
    runScript('prereqs.ts', { ...process.env, JR_RESULTS: join(temp(), 'results.txt'), JR_TEST_PORT: '4794', JR_REAL_SETTINGS: realSettings(settings) });

  it('your own AI server answers, so the empty ai folder is fine', async () => {
    const yours = await listen((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(req.url === '/v1/models' ? '{"data":[{"id":"bonsai"}]}' : '{}');
    });
    try {
      const out = await prereqs({ ai: { preset: 'custom', baseUrl: `http://127.0.0.1:${yours.port}/v1`, model: 'bonsai-2' } });
      expect(out).toContain(`PASS your AI server answers - http://127.0.0.1:${yours.port}/v1 (you run it; the app never starts or stops it)`);
      expect(out).not.toContain('downloaded');
    } finally {
      await yours.close();
    }
  });

  it("your own AI server doesn't answer", async () => {
    const nothing = await freePort();
    const out = await prereqs({ ai: { preset: 'custom', baseUrl: `http://127.0.0.1:${nothing}/v1`, model: 'bonsai-2' } });
    expect(out).toContain(`FAIL your AI server answers - nothing answers at http://127.0.0.1:${nothing}/v1.`);
  });

  it('Bonsai 2 started by the app, but not downloaded: it says both ways out', async () => {
    const out = await prereqs({ ai: { managed: { exe: '/nowhere/llama-server.exe', args: ['-m', '/nowhere/bonsai.gguf'] } } });
    expect(out).toContain("FAIL the app's own Bonsai 2 is downloaded - missing /nowhere/llama-server.exe.");
    expect(out).toContain('Run download-ai.bat, or point the app at the Bonsai 2 you run yourself');
  });
});

describe("handover: your real install's AI, in the read-only checks", () => {
  // Your app, as far as these checks see it.
  const yourApp = (aiTest: object) =>
    listen((req, res) => {
      res.setHeader('content-type', 'application/json');
      const answers: Record<string, unknown> = {
        'GET /api/v1/health': { ok: true },
        'GET /api/v1/settings': {},
        'GET /api/v1/settings/secrets': { emailPassword: false },
        'GET /api/v1/ai/status': { state: 'ready', baseUrl: 'http://127.0.0.1:8080/v1' },
        'POST /api/v1/ai/test': aiTest,
      };
      res.end(JSON.stringify(answers[`${req.method} ${req.url}`] ?? {}));
    });

  it.each([
    [{ ok: true, detail: 'Connected to Another OpenAI-style server. It replied in 900 ms.' }, "PASS the app's AI answers - Connected to Another OpenAI-style server. It replied in 900 ms."],
    [{ ok: false, detail: "The AI program isn't installed." }, "FAIL the app's AI answers - The AI program isn't installed."],
  ])('asks the app to test its AI, as Settings -> AI does: %o', async (aiTest, line) => {
    const app = await yourApp(aiTest);
    try {
      const env = { ...process.env, JR_RESULTS: join(temp(), 'results.txt'), JR_REAL_SETTINGS: realSettings({ server: { port: app.port } }) };
      const out = await runScript('real-checks.ts', env);
      expect(out).toContain(`PASS the app is running - port ${app.port}`);
      expect(out).toContain(line);
    } finally {
      await app.close();
    }
  });
});

describe('handover: the read-only checks run cleanly here too', () => {
  it('a port that answers with anything, even a 404, is not free', async () => {
    const port = await freePort();
    const server = createServer((_q, r) => {
      r.statusCode = 404;
      r.end();
    }).listen(port, '127.0.0.1');
    try {
      const base = temp();
      const env = { ...process.env, JR_RESULTS: join(base, 'results.txt'), JR_TEST_PORT: String(port) };
      const res = await runScript('prereqs.ts', env);
      expect(res).toContain(`FAIL port ${port} is free for the checks`);
      expect(res).not.toContain('DEP0190');
    } finally {
      server.close();
    }
  });

  it('signing without the keys only says so', () => {
    const base = temp();
    const env = { ...process.env, JR_RESULTS: join(base, 'results.txt'), WEB_EXT_API_KEY: '', WEB_EXT_API_SECRET: '' };
    const res = spawnSync(process.execPath, ['scripts/handover/sign.ts'], { env, encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('INFO not signed - no addons.mozilla.org keys');
  });

  it.each(['prereqs.ts', 'collect-logs.ts', 'cleanup.ts'])('%s runs and reports', (script) => {
    const base = temp();
    const env = { ...process.env, JR_RESULTS: join(base, 'results.txt'), JR_TEST_ROOT: join(base, 'none'), JR_TEST_PORT: '4791' };
    const res = spawnSync(process.execPath, [`scripts/handover/${script}`], { env, encoding: 'utf8', timeout: 60_000 });
    const out = res.stdout + res.stderr;
    expect(out).toMatch(/^(PASS|INFO|FAIL) /m);
    expect(out).toMatch(/: (all PASS\.|\d+ FAIL\.)/);
    expect(readFileSync(join(base, 'results.txt'), 'utf8')).toContain(script.replace('.ts', ''));
  });
});
