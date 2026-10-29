// The Windows handover checks (scripts/handover/). Their logic and their
// HTTP checks run here; the .bat files and Windows processes only on the PC.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Settings } from '../shared/contracts/index.ts';
import { createServer } from 'node:http';
import { createReport, keepInTestCopy, killPortListeners, prepareTestRoot, testSettings } from '../scripts/handover/lib.ts';
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
      const res = await new Promise<string>((resolveOut) => {
        const child = spawn(process.execPath, ['scripts/handover/prereqs.ts'], { env });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        child.on('close', () => resolveOut(out));
      });
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
