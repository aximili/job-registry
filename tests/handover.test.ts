// The Windows handover checks (scripts/handover/). Their logic and their
// HTTP checks run here; the .bat files and Windows processes only on the PC.

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { activeAi, AI_PRESETS, AiPresetId, DEFAULT_SETTINGS, Settings } from '../shared/contracts/index.ts';
import { createServer, type RequestListener } from 'node:http';
import { appAi, createReport, findFirefox, keepInTestCopy, killPortListeners, prepareTestRoot, testSettings } from '../scripts/handover/lib.ts';
import { freePort } from './helpers/test-app.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'jr-handover-'));
  dirs.push(dir);
  return dir;
};

// Your own settings, for a check that reads them, in a temp file. Your
// secrets, if given, sit next to it, as in config\.
const realSettings = (settings: object, secrets?: object) => {
  const file = join(temp(), 'settings.json');
  writeFileSync(file, JSON.stringify(settings));
  if (secrets) writeFileSync(join(dirname(file), 'secrets.json'), JSON.stringify(secrets));
  return file;
};

// Two saved AIs, with a cloud one in use. Its address is one where nothing
// listens, so a check that wrongly tried it could never reach Anthropic.
const CLOUD_IN_USE = {
  ai: {
    active: 'claude-work',
    saved: [
      { id: 'bonsai-2', name: 'Bonsai 2' },
      { id: 'claude-work', name: 'Claude (work)', preset: 'anthropic', baseUrl: 'http://127.0.0.1:9/v1', model: 'claude-sonnet-5-5' },
    ],
  },
};
const CLOUD_KEY = 'sk-ant-api03-handover-test-key';
const CLOUD_SKIP = 'SKIP the local AI checks - the AI in use is Claude (work), a cloud AI; these checks are for Bonsai 2';

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

  it('prints SKIP lines, and counts them when nothing failed', () => {
    const file = join(temp(), 'r.txt');
    const out: string[] = [];
    const report = createReport('demo', { resultsFile: file, print: (l) => out.push(l) });
    report.pass('fine');
    report.skip('the local AI checks', 'the AI in use is Claude, a cloud AI; these checks are for Bonsai 2');
    expect(report.finish()).toBe(0);
    expect(out).toEqual([
      'PASS fine',
      'SKIP the local AI checks - the AI in use is Claude, a cloud AI; these checks are for Bonsai 2',
      'demo: all PASS, 1 SKIP.',
    ]);
    expect(readFileSync(file, 'utf8')).toContain('demo: SKIP the local AI checks');
  });

  it('a FAIL still ends the same way when something was skipped too', () => {
    const out: string[] = [];
    const report = createReport('demo', { resultsFile: join(temp(), 'r.txt'), print: (l) => out.push(l) });
    report.skip('one thing', 'why');
    report.fail('another thing', 'what went wrong');
    expect(report.finish()).toBe(1);
    expect(out.at(-1)).toBe('demo: 1 FAIL. Write each FAIL in handover-results\\bugs\\.');
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
  // A lock is chmod on macOS and Linux; on Windows a live process holds the
  // folder as its working directory, which blocks deleting it.
  it('keeps its marker when a file in the old copy is locked, so the next run can try again', { timeout: 30_000 }, async () => {
    const dir = join(temp(), 'copy');
    prepareTestRoot(dir);
    const locked = join(dir, 'zz-locked');
    mkdirSync(locked);
    writeFileSync(join(locked, 'file.txt'), 'x');
    const holding =
      process.platform === 'win32'
        ? spawn(process.execPath, ['-e', 'console.log(1); setInterval(() => {}, 1 << 30)'], { cwd: locked, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
        : null;
    // It holds the folder only once it runs, so the delete waits for its first line.
    if (holding) await once(holding.stdout!, 'data');
    chmodSync(locked, 0o500);
    try {
      expect(() => prepareTestRoot(dir)).toThrow();
      expect(existsSync(join(dir, '.jr-test-copy'))).toBe(true);
    } finally {
      chmodSync(locked, 0o700);
      holding?.kill('SIGKILL');
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
    expect(activeAi(s.ai)).toMatchObject({ preset: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'none' });
    expect(s.email.enabled).toBe(false);
  });

  // setup.ps1's running-check asks port.mjs for the port, and port.mjs reads
  // the settings next to itself. In the test copy those are the copy's own
  // settings, so the check never probes the real app on 4777.
  it('port.mjs reads the port from the settings next to it, and falls back to 4777', () => {
    const base = temp();
    mkdirSync(join(base, 'scripts'), { recursive: true });
    copyFileSync(resolve('scripts/port.mjs'), join(base, 'scripts', 'port.mjs'));
    mkdirSync(join(base, 'config'), { recursive: true });
    writeFileSync(join(base, 'config', 'settings.json'), JSON.stringify({ server: { port: 4787 } }));
    const withSettings = spawnSync(process.execPath, [join(base, 'scripts', 'port.mjs')], { encoding: 'utf8' });
    expect(withSettings.stdout.trim()).toBe('4787');
    rmSync(join(base, 'config'), { recursive: true, force: true });
    const without = spawnSync(process.execPath, [join(base, 'scripts', 'port.mjs')], { encoding: 'utf8' });
    expect(without.stdout.trim()).toBe('4777');
  });

  it('test settings for the AI check run their own llama-server on 8081, from the real ai folder', () => {
    const s = Settings.parse(
      testSettings({ port: 4787, llama: { exe: 'C:\\JR\\ai\\llama.cpp\\llama-server.exe', model: 'C:\\JR\\ai\\models\\m.gguf', port: 8081 } }),
    );
    // The AI check tests the idle stop, so its test copy turns it on.
    const ai = activeAi(s.ai);
    expect(ai).toMatchObject({ preset: 'llama-server', baseUrl: 'http://127.0.0.1:8081/v1', idleMinutes: 1, stopWhenIdle: true });
    expect(ai.managed).toMatchObject({ enabled: true, exe: 'C:\\JR\\ai\\llama.cpp\\llama-server.exe', startTimeoutSec: 240 });
    expect(ai.managed.args).toEqual(['-m', 'C:\\JR\\ai\\models\\m.gguf', '-ngl', '99', '-fa', 'on', '-c', '16384', '--jinja', '--port', '8081']);
  });

  it('test settings for the AI check can use the AI server you run yourself, as your settings do', () => {
    const yours = activeAi(Settings.parse({ ai: { preset: 'custom', baseUrl: 'http://127.0.0.1:8080/v1', model: 'bonsai-2', tasks: { write: { maxTokens: 6000 } } } }).ai);
    const s = Settings.parse(testSettings({ port: 4787, external: yours }));
    expect(s.server.port).toBe(4787);
    expect(activeAi(s.ai)).toEqual(yours);
    expect(s.email.enabled).toBe(false);
  });
});

describe('handover: which AI your settings use', () => {
  const aiOf = (settings: object) => Settings.parse(settings).ai;

  it('a server you run yourself: another preset, or llama-server that the app does not start', () => {
    const custom = aiOf({ ai: { preset: 'custom', baseUrl: 'http://127.0.0.1:8080/v1', model: 'bonsai-2' } });
    expect(appAi(custom, '/app')).toEqual({ kind: 'external', baseUrl: 'http://127.0.0.1:8080/v1' });
    const ollama = aiOf({ ai: { preset: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' } });
    expect(appAi(ollama, '/app')).toEqual({ kind: 'external', baseUrl: 'http://127.0.0.1:11434/v1' });
    const unmanaged = aiOf({ ai: { managed: { enabled: false } } });
    expect(appAi(unmanaged, '/app')).toEqual({ kind: 'external', baseUrl: 'http://127.0.0.1:8080/v1' });
  });

  it('your own start_bonsai.bat: the app only opens it, so the checks treat it as a server you run', () => {
    const bat = aiOf({ ai: { managed: { exe: 'D:\\aitest\\Bonsai-demo\\start_bonsai.bat' } } });
    expect(appAi(bat, '/app')).toEqual({ kind: 'external', baseUrl: 'http://127.0.0.1:8080/v1' });
    const cmd = aiOf({ ai: { managed: { exe: 'start.CMD' } } });
    expect(appAi(cmd, '/app')).toMatchObject({ kind: 'external' });
  });

  it('Bonsai 2 started by the app: its program and model, from the app folder or anywhere else', () => {
    expect(appAi(DEFAULT_SETTINGS.ai, '/app')).toEqual({
      kind: 'managed',
      exe: resolve('/app', 'ai/llama.cpp/llama-server.exe'),
      model: resolve('/app', 'ai/models/Ternary-Bonsai-2-27B-PQ2_0.gguf'),
    });
    const elsewhere = aiOf({ ai: { managed: { exe: '/aitest/llama-server', args: ['--model', '/aitest/bonsai.gguf', '--port', '8080'] } } });
    expect(appAi(elsewhere, '/app')).toEqual({ kind: 'managed', exe: '/aitest/llama-server', model: '/aitest/bonsai.gguf' });
    const noModel = aiOf({ ai: { managed: { args: ['--port', '8080'] } } });
    expect(appAi(noModel, '/app')).toMatchObject({ kind: 'managed', model: null });
  });

  it('only the AI in use counts, out of all your saved AIs', () => {
    const saved = [
      { id: 'bonsai-2', name: 'Bonsai 2' },
      { id: 'my-server', name: 'My server', preset: 'custom', baseUrl: 'http://127.0.0.1:8090/v1', model: 'x' },
      CLOUD_IN_USE.ai.saved[1],
    ];
    expect(appAi(aiOf({ ai: { active: 'my-server', saved } }), '/app')).toEqual({ kind: 'external', baseUrl: 'http://127.0.0.1:8090/v1' });
    expect(appAi(aiOf({ ai: { active: 'bonsai-2', saved } }), '/app')).toMatchObject({ kind: 'managed' });
    expect(appAi(aiOf({ ai: { active: 'claude-work', saved } }), '/app')).toEqual({ kind: 'cloud', name: 'Claude (work)' });
  });

  it.each(AiPresetId.options)('%s in use: a cloud AI only when its preset is one', (preset) => {
    const ai = aiOf({ ai: { active: 'one', saved: [{ id: 'one', name: 'One', preset, baseUrl: 'http://127.0.0.1:8090/v1', model: 'm' }] } });
    expect(appAi(ai, '/app').kind === 'cloud').toBe(AI_PRESETS[preset].group === 'cloud');
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

  it('says when the AI check was skipped for a cloud AI', () => {
    const base = temp();
    const results = join(base, 'results.txt');
    writeFileSync(results, [
      '2026-11-02 10:00:00 prereqs: prereqs: all PASS, 1 SKIP.',
      `2026-11-02 10:05:00 ai-smoke: ${CLOUD_SKIP}`,
      '2026-11-02 10:05:01 ai-smoke: ai-smoke: all PASS, 1 SKIP.',
      '',
    ].join('\r\n'));
    const res = spawnSync(process.execPath, ['scripts/handover/summary.ts'], { env: { ...process.env, JR_RESULTS: results }, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    const summary = readFileSync(join(base, 'summary.md'), 'utf8');
    expect(summary).toContain('- prereqs: all PASS, 1 SKIP');
    expect(summary).toContain('- ai-smoke: all PASS, 1 SKIP');
    expect(summary).toContain('- The AI check used: skipped - the AI in use is Claude (work), a cloud AI; these checks are for Bonsai 2');
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
      'PASS the AI gives a job card a quick mark',
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
        // A key for this AI in your secrets, which must stay out of the test copy.
        JR_REAL_SETTINGS: realSettings(
          { ai: { preset: 'custom', baseUrl: `http://127.0.0.1:${aiPort}/v1`, model: 'bonsai-2' } },
          { emailPassword: null, aiKeys: { 'my-ai-server': 'sk-local-handover-test-key' } },
        ),
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
        'PASS the AI gives a job card a quick mark',
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
      expect(existsSync(join(root, 'config', 'secrets.json'))).toBe(false);
      const copied = readFileSync(join(root, 'config', 'settings.json'), 'utf8');
      expect(copied).not.toContain('sk-local-handover-test-key');
      expect(copied).not.toContain('aiKeys');
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

// The test copy never gets a key, so a cloud AI can't be checked there.
describe.skipIf(process.platform === 'win32')('handover: a cloud AI in use', () => {
  it('the AI check and the reading report skip, and no key goes into the test copy', { timeout: 60_000 }, async () => {
    const base = temp();
    const root = join(base, 'copy');
    const env = {
      ...process.env,
      JR_TEST_ROOT: root,
      JR_RESULTS: join(base, 'results.txt'),
      JR_TEST_PORT: '4795',
      JR_REAL_SETTINGS: realSettings(CLOUD_IN_USE, { emailPassword: null, aiKeys: { 'claude-work': CLOUD_KEY } }),
    };
    const made = spawnSync(process.execPath, ['scripts/handover/make-test-copy.ts', '--link-modules'], { env, encoding: 'utf8' });
    expect(made.status, made.stdout + made.stderr).toBe(0);

    const ai = await runScript('ai-smoke.ts', env);
    expect(ai).toContain(CLOUD_SKIP);
    expect(ai).toContain('ai-smoke: all PASS, 1 SKIP.');
    expect(ai).not.toContain('the app starts');
    expect(ai).not.toContain('the AI used');

    const report = await runScript('eval-report.ts', env);
    expect(report).toContain(CLOUD_SKIP);
    expect(report).toContain('eval-report: all PASS, 1 SKIP.');
    expect(existsSync(join(base, 'eval-report.txt'))).toBe(false);

    expect(existsSync(join(root, 'config', 'secrets.json'))).toBe(false);
    const copied = readFileSync(join(root, 'config', 'settings.json'), 'utf8');
    expect(copied).not.toContain(CLOUD_KEY);
    expect(copied).not.toContain('aiKeys');
    // Still the settings make-test-copy wrote: an AI address where nothing listens.
    expect(activeAi(Settings.parse(JSON.parse(copied)).ai).baseUrl).toBe('http://127.0.0.1:9/v1');
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

  it('a cloud AI in use: the local AI checks are skipped', async () => {
    const out = await prereqs(CLOUD_IN_USE);
    expect(out).toContain(CLOUD_SKIP);
    expect(out).not.toContain('your AI server answers');
    expect(out).not.toContain('downloaded');
  });

  it('Bonsai 2 started by the app, but not downloaded: it says both ways out', async () => {
    const out = await prereqs({ ai: { managed: { exe: '/nowhere/llama-server.exe', args: ['-m', '/nowhere/bonsai.gguf'] } } });
    expect(out).toContain("FAIL the app's own Bonsai 2 is downloaded - missing /nowhere/llama-server.exe.");
    expect(out).toContain('Run download-ai.bat, or point the app at the Bonsai 2 you run yourself');
  });
});

describe("handover: your real install's AI, in the read-only checks", () => {
  // Your app, as far as these checks see it.
  const yourApp = (aiTest: object, secrets: object = { emailPassword: false, aiKeys: [] }) =>
    listen((req, res) => {
      res.setHeader('content-type', 'application/json');
      const answers: Record<string, unknown> = {
        'GET /api/v1/health': { ok: true },
        'GET /api/v1/settings': {},
        'GET /api/v1/settings/secrets': secrets,
        'GET /api/v1/ai/status': { state: 'ready', name: 'Bonsai 2', baseUrl: 'http://127.0.0.1:8080/v1' },
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
      expect(out).toContain('INFO the AI in use - Bonsai 2, ready (http://127.0.0.1:8080/v1)');
      expect(out).toContain(line);
      expect(out).toContain('PASS no password comes back from the app');
    } finally {
      await app.close();
    }
  });

  it('API keys come back only as the ids of the AIs that have one', async () => {
    const ok = { ok: true, detail: 'Connected.' };
    const saved = { ai: { active: 'bonsai-2', saved: [{ id: 'bonsai-2', name: 'Bonsai 2' }, { id: 'claude-mine', name: 'Claude – mine', preset: 'custom' }] } };
    for (const [secrets, line] of [
      [{ emailPassword: true, aiKeys: ['claude-mine'] }, 'PASS no password comes back from the app'],
      [{ emailPassword: true, aiKeys: ['sk-ant-api03-abc'] }, 'FAIL no password comes back from the app'],
      [{ emailPassword: 'abcdefghijklmnop', aiKeys: [] }, 'FAIL no password comes back from the app'],
    ] as const) {
      const app = await yourApp(ok, secrets);
      try {
        const env = { ...process.env, JR_RESULTS: join(temp(), 'results.txt'), JR_REAL_SETTINGS: realSettings({ server: { port: app.port }, ...saved }) };
        expect(await runScript('real-checks.ts', env)).toContain(line);
      } finally {
        await app.close();
      }
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
