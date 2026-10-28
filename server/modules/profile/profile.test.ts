import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';
import { createEventBus } from '../../core/events.ts';
import { createProfileModule } from './index.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const NOW = new Date('2026-10-28T03:15:00.000Z');

function setup(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jr-profile-'));
  dirs.push(root);
  const dir = join(root, 'profile');
  const templatesDir = join(root, 'templates');
  const startersDir = join(root, 'starters');
  for (const d of [dir, templatesDir, join(startersDir, 'profile'), join(startersDir, 'templates')]) mkdirSync(d, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  const events: [string, unknown][] = [];
  const bus = createEventBus(pino({ level: 'silent' }));
  bus.onAny((name, payload) => events.push([name, payload]));
  const profile = createProfileModule({ dir, templatesDir, startersDir, bus, now: () => NOW }).service;
  return { root, dir, templatesDir, startersDir, profile, events };
}

describe('profile files', () => {
  it('read returns null for a missing or blank file, and drops a byte-order mark', () => {
    const bom = String.fromCharCode(0xfeff);
    const { profile } = setup({ 'profile/preferences.md': '  \n ', 'profile/master-profile.md': `${bom}# Me\nI write TypeScript.` });
    expect(profile.read('master-profile')).toBe('# Me\nI write TypeScript.');
    expect(profile.read('preferences')).toBeNull();
    expect(setup().profile.read('master-profile')).toBeNull();
  });

  it('the hash changes when the master profile or preferences change, but not a template', () => {
    const { profile } = setup({ 'profile/master-profile.md': 'A' });
    const first = profile.hash();
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    profile.write('preferences', 'Remote only');
    const second = profile.hash();
    profile.write('resume', 'h1 { color: navy; }');
    expect(profile.hash()).toBe(second);
    profile.write('master-profile', 'B');
    expect(new Set([first, second, profile.hash()]).size).toBe(3);
  });

  it('writes Markdown files to profile/ and CSS files to templates/, and reads them back', () => {
    const { dir, templatesDir, profile } = setup();
    const names = ['master-profile', 'preferences', 'resume-guide', 'cover-letter-guide', 'resume', 'cover-letter'] as const;
    for (const name of names) {
      const file = profile.write(name, `text of ${name}`);
      expect(file).toEqual({ name, text: `text of ${name}`, updatedAt: expect.any(String) });
      expect(profile.file(name).text).toBe(`text of ${name}`);
    }
    expect(readFileSync(join(dir, 'resume-guide.md'), 'utf8')).toBe('text of resume-guide');
    expect(readFileSync(join(templatesDir, 'cover-letter.css'), 'utf8')).toBe('text of cover-letter');
    expect(existsSync(join(dir, 'resume.css'))).toBe(false);
  });

  it('a missing file reads as empty text with no date', () => {
    expect(setup().profile.file('preferences')).toEqual({ name: 'preferences', text: '', updatedAt: null });
  });

  it('write sends profile.changed with the name', () => {
    const { profile, events } = setup();
    profile.write('resume-guide', 'Keep it short.');
    expect(events).toEqual([['profile.changed', { name: 'resume-guide' }]]);
  });

  it('installs the starters only where a file is missing, and never a master profile or preferences', () => {
    const { dir, templatesDir, startersDir, profile } = setup();
    for (const name of ['resume-guide.md', 'cover-letter-guide.md']) writeFileSync(join(startersDir, 'profile', name), `starter ${name}`);
    for (const name of ['resume.css', 'cover-letter.css']) writeFileSync(join(startersDir, 'templates', name), `starter ${name}`);
    writeFileSync(join(templatesDir, 'resume.css'), 'mine');

    expect(profile.installStarters().sort()).toEqual(['cover-letter', 'cover-letter-guide', 'resume-guide']);
    expect(readFileSync(join(templatesDir, 'resume.css'), 'utf8')).toBe('mine');
    expect(readFileSync(join(dir, 'resume-guide.md'), 'utf8')).toBe('starter resume-guide.md');
    expect(existsSync(join(dir, 'master-profile.md'))).toBe(false);
    expect(existsSync(join(dir, 'preferences.md'))).toBe(false);
    expect(profile.installStarters()).toEqual([]);
  });

  it('the real starters exist for both guides and both templates', () => {
    const starters = new URL('../../../starters/', import.meta.url);
    for (const file of ['profile/resume-guide.md', 'profile/cover-letter-guide.md', 'templates/resume.css', 'templates/cover-letter.css']) {
      expect(readFileSync(new URL(file, starters), 'utf8').length, file).toBeGreaterThan(100);
    }
    expect(readFileSync(new URL('templates/resume.css', starters), 'utf8')).toMatch(/@page\s*\{[^}]*size:\s*A4/);
  });
});

describe('profile routes', () => {
  let app: TestApp;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.cleanup();
  });

  it('GET and PUT a profile file', async () => {
    const put = await app.request('PUT', '/api/v1/profile/master-profile', { text: '# Sam Taylor' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ name: 'master-profile', text: '# Sam Taylor' });
    const got = await app.request('GET', '/api/v1/profile/master-profile');
    expect(got.body.text).toBe('# Sam Taylor');
  });

  it('the app installs the starters when it starts', async () => {
    const res = await app.request('GET', '/api/v1/profile/resume');
    expect(res.body.text).toMatch(/@page/);
  });

  it('an unknown name is a 404', async () => {
    const res = await app.request('GET', '/api/v1/profile/secrets');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe("There's no profile file called secrets.");
  });

  it('only the dashboard can change a profile file', async () => {
    const res = await app.request('PUT', '/api/v1/profile/master-profile', { text: 'x' }, { origin: 'moz-extension://abc' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Only the dashboard can change your profile and templates.');
  });
});
