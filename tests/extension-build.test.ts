// Builds the extension into a temporary folder and checks what Firefox and
// Chrome will load: the merged manifests, every file they name, and
// Mozilla's own checks (web-ext lint).
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
let out: string;

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'jr-ext-'));
  await run(process.execPath, [join(root, 'extension', 'build.mjs'), '--out', out], { cwd: root });
}, 120_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

const manifest = (browser: string) => JSON.parse(readFileSync(join(out, browser, 'manifest.json'), 'utf8'));

function referencedFiles(m: Record<string, any>): string[] {
  return [
    ...(m.background?.scripts ?? []),
    ...(m.background?.service_worker ? [m.background.service_worker] : []),
    ...m.content_scripts.flatMap((c: { js: string[] }) => c.js),
    m.action.default_popup,
    m.options_ui.page,
    ...Object.values(m.icons as Record<string, string>),
    'generic.js',
  ];
}

describe('extension build', () => {
  it('Firefox gets an event page and its add-on id; Chrome gets a service worker', () => {
    const firefox = manifest('firefox');
    expect(firefox.manifest_version).toBe(3);
    expect(firefox.background).toEqual({ scripts: ['background.js'] });
    expect(firefox.browser_specific_settings.gecko).toMatchObject({ id: 'job-registry@local', strict_min_version: '140.0' });
    const chrome = manifest('chrome');
    expect(chrome.background).toEqual({ service_worker: 'background.js' });
    expect(chrome.browser_specific_settings).toBeUndefined();
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    expect(firefox.version).toBe(version);
  });

  it('asks only for what it needs, and reads only the three job sites', () => {
    const m = manifest('firefox');
    expect(m.permissions).toEqual(['storage', 'activeTab', 'scripting']);
    expect(m.host_permissions).toEqual([
      'http://127.0.0.1/*',
      'http://localhost/*',
      'https://www.seek.com.au/*',
      'https://www.seek.co.nz/*',
      'https://au.seek.com/*',
      'https://nz.seek.com/*',
      'https://*.linkedin.com/*',
      'https://*.indeed.com/*',
    ]);
    // All of LinkedIn (and its country sites): it moves to job pages without reloading.
    // Seek now uses au.seek.com and nz.seek.com. The older addresses stay too.
    expect(m.content_scripts[0].matches).toEqual([
      'https://www.seek.com.au/*',
      'https://www.seek.co.nz/*',
      'https://au.seek.com/*',
      'https://nz.seek.com/*',
      'https://*.linkedin.com/*',
      'https://*.indeed.com/*',
    ]);
    expect(m.commands._execute_action.suggested_key.default).toBe('Alt+Shift+J');
  });

  it('every file the manifests name is there', () => {
    for (const browser of ['firefox', 'chrome']) {
      for (const file of referencedFiles(manifest(browser))) expect(existsSync(join(out, browser, file)), `${browser}/${file}`).toBe(true);
    }
  });

  it("passes Mozilla's checks (web-ext lint) with no errors", async () => {
    const { stdout } = await run(process.execPath, [join(root, 'node_modules', 'web-ext', 'bin', 'web-ext.js'), 'lint', '-s', join(out, 'firefox'), '--output', 'json'], { cwd: root }).catch(
      (err: { stdout: string }) => ({ stdout: err.stdout }),
    );
    const report = JSON.parse(stdout) as { errors: { message: string }[]; warnings: { code: string; file: string }[] };
    expect(report.errors.map((e) => e.message)).toEqual([]);
    // The only warnings left are innerHTML inside Svelte's own template code
    // and Mozilla's Readability: no manifest warnings.
    expect(report.warnings.filter((w) => w.code !== 'UNSAFE_VAR_ASSIGNMENT')).toEqual([]);
  }, 120_000);
});

describe('ext:check', () => {
  it("prints what a site's reader finds on a saved page", async () => {
    const { stdout } = await run(process.execPath, [join(root, 'scripts', 'ext-check.ts'), join(root, 'tests', 'fixtures', 'sites', 'seek-job.html'), 'https://www.seek.com.au/job/81234567'], { cwd: root });
    expect(stdout).toContain('Reader: seek');
    expect(stdout).toContain('Title:    Senior Software Engineer');
    expect(stdout).toContain('Company:  Atlassian');
  }, 60_000);

  it('prints the job cards it finds on a search list', async () => {
    const { stdout } = await run(process.execPath, [join(root, 'scripts', 'ext-check.ts'), join(root, 'tests', 'fixtures', 'sites', 'seek-search-real.html'), 'https://au.seek.com/full-stack-developer-jobs/in-All-Melbourne-VIC'], { cwd: root });
    expect(stdout).toContain('Cards: 10');
    expect(stdout).toContain('95571906  Full-Stack Software Developer · Soniq Digital Media Pty Ltd · Richmond, Melbourne VIC');
  }, 60_000);
});

describe('signing', () => {
  it('each signing gets a newer version than the last, as addons.mozilla.org requires', async () => {
    const { signingVersion } = await import('../extension/version.mjs');
    const a = signingVersion('0.1.0', new Date('2026-10-28T03:15:00Z'));
    const b = signingVersion('0.1.0', new Date('2026-10-28T03:16:00Z'));
    expect(a).toMatch(/^0\.1\.0\.\d{1,9}$/);
    const last = (v: string) => Number(v.split('.').at(-1));
    expect(last(b)).toBeGreaterThan(last(a));
  });
});

