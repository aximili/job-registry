import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';
import { ConflictError, ValidationError } from '../../core/errors.ts';
import { createEventBus } from '../../core/events.ts';
import { createProfileModule } from './index.ts';
import { normaliseStarter } from './starters.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// 14:15 in Sydney, where the tests run (vitest.config.ts), so old versions are named 2026-10-28-141500.
const NOW = new Date('2026-10-28T03:15:00.000Z');
const STAMP = '2026-10-28-141500';

const sha256 = (text: string) => createHash('sha256').update(normaliseStarter(text)).digest('hex');
// What .starter-versions.json says you've seen.
const seen = (dir: string) => JSON.parse(readFileSync(join(dir, '.starter-versions.json'), 'utf8'));
// Git for Windows checks .md files out with Windows line endings.
const crlf = (text: string) => normaliseStarter(text).replace(/\n/g, '\r\n');
const oldVersions = (dir: string) => (existsSync(join(dir, 'old-versions')) ? readdirSync(join(dir, 'old-versions')).sort() : []);

function setup(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jr-profile-'));
  dirs.push(root);
  const dir = join(root, 'profile');
  const templatesDir = join(root, 'templates');
  const startersDir = join(root, 'starters');
  for (const d of [dir, templatesDir, join(startersDir, 'profile'), join(startersDir, 'templates')]) mkdirSync(d, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
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

  it('copies a starter in only where a file is missing, records the guides, and never adds a master profile or preferences', () => {
    const { dir, templatesDir, startersDir, profile } = setup();
    for (const name of ['resume-guide.md', 'cover-letter-guide.md']) writeFileSync(join(startersDir, 'profile', name), `starter ${name}`);
    for (const name of ['resume.css', 'cover-letter.css']) writeFileSync(join(startersDir, 'templates', name), `starter ${name}`);
    writeFileSync(join(templatesDir, 'resume.css'), 'mine');

    const { copied, updated } = profile.syncStarters();
    expect(copied.sort()).toEqual(['cover-letter', 'cover-letter-guide', 'resume-guide']);
    expect(updated).toEqual([]);
    expect(readFileSync(join(templatesDir, 'resume.css'), 'utf8')).toBe('mine');
    expect(readFileSync(join(dir, 'resume-guide.md'), 'utf8')).toBe('starter resume-guide.md');
    expect(existsSync(join(dir, 'master-profile.md'))).toBe(false);
    expect(existsSync(join(dir, 'preferences.md'))).toBe(false);
    expect(seen(dir)).toEqual({ 'resume-guide': sha256('starter resume-guide.md'), 'cover-letter-guide': sha256('starter cover-letter-guide.md') });
    expect(profile.syncStarters()).toEqual({ copied: [], updated: [], failed: [] });
  });

  it('the real starters exist for both guides and both templates', () => {
    const starters = new URL('../../../starters/', import.meta.url);
    for (const file of ['profile/resume-guide.md', 'profile/cover-letter-guide.md', 'templates/resume.css', 'templates/cover-letter.css']) {
      expect(readFileSync(new URL(file, starters), 'utf8').length, file).toBeGreaterThan(100);
    }
    expect(readFileSync(new URL('templates/resume.css', starters), 'utf8')).toMatch(/@page\s*\{[^}]*size:\s*A4/);
  });
});

// An editor sends the updatedAt it loaded, so a save can't undo a change
// made since: answers added to the master profile, or a new starter guide.
describe('write: a save from an editor opened before the file changed', () => {
  const CHANGED = 'This file changed since you opened it. Reload the page to see the new text, then make your change again.';
  // Long before now, so a change made in the test has another time.
  const backdate = (path: string) => utimesSync(path, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
  const refusal = (fn: () => unknown): unknown => {
    try {
      fn();
    } catch (err) {
      return err;
    }
    return null;
  };

  it('is refused after answers were added to the master profile, and the answers stay', () => {
    const { dir, profile, events } = setup({ 'profile/master-profile.md': '# Sam Taylor\n' });
    backdate(join(dir, 'master-profile.md'));
    const loaded = profile.file('master-profile');
    profile.appendAnswers(['- 3 Nov 2026, Senior Engineer at Example Co: Have you used Go? Yes, a small CLI.']);
    const added = readFileSync(join(dir, 'master-profile.md'), 'utf8');
    events.length = 0;

    const err = refusal(() => profile.write('master-profile', '# Sam Taylor\nMy edit.\n', { updatedAt: loaded.updatedAt }));
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toBe(CHANGED);
    expect(readFileSync(join(dir, 'master-profile.md'), 'utf8')).toBe(added);
    expect(events).toEqual([]);
  });

  it('is refused after Use the new guide', () => {
    const { dir, startersDir, profile } = setup({ 'profile/cover-letter-guide.md': 'My own guide.\n' });
    writeFileSync(join(startersDir, 'profile', 'cover-letter-guide.md'), 'The new starter.\n');
    backdate(join(dir, 'cover-letter-guide.md'));
    const loaded = profile.file('cover-letter-guide');
    profile.useStarter('cover-letter-guide');
    expect(refusal(() => profile.write('cover-letter-guide', 'My own guide, edited.\n', { updatedAt: loaded.updatedAt }))).toBeInstanceOf(ConflictError);
    expect(readFileSync(join(dir, 'cover-letter-guide.md'), 'utf8')).toBe('The new starter.\n');
  });

  it('is refused when a file that was missing when the editor opened is there now', () => {
    const { profile } = setup();
    const loaded = profile.file('preferences');
    profile.write('preferences', 'Sydney only.\n');
    expect(refusal(() => profile.write('preferences', 'Remote.\n', { updatedAt: loaded.updatedAt }))).toBeInstanceOf(ConflictError);
  });

  it('goes ahead when the file is as the editor loaded it, and with no updatedAt, as before', () => {
    const { dir, profile, events } = setup({ 'profile/master-profile.md': '# Sam Taylor\n' });
    backdate(join(dir, 'master-profile.md'));
    const saved = profile.write('master-profile', '# Sam Taylor\nFirst edit.\n', { updatedAt: profile.file('master-profile').updatedAt });
    expect(saved.text).toBe('# Sam Taylor\nFirst edit.\n');
    // A missing file, loaded as missing.
    expect(profile.write('preferences', 'Sydney only.\n', { updatedAt: null }).text).toBe('Sydney only.\n');
    // Scripts and older callers send no updatedAt.
    backdate(join(dir, 'master-profile.md'));
    profile.appendAnswers(['- 3 Nov 2026: Have you used Go? Yes.']);
    expect(profile.write('master-profile', '# Sam Taylor\nSecond edit.\n').text).toBe('# Sam Taylor\nSecond edit.\n');
    expect(events.filter(([name]) => name === 'profile.changed')).toHaveLength(4);
  });
});

// The app's real starters, and copies of the earlier versions of each guide
// (from git: tests/fixtures/starters/<name>.<commit>.md).
const REAL_STARTERS = fileURLToPath(new URL('../../../starters/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/starters/', import.meta.url));
const EARLIER = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.md'))
  .sort()
  .map((file) => ({ file, name: file.slice(0, file.indexOf('.')) as 'resume-guide' | 'cover-letter-guide' }));

function setupWithRealStarters(files: Record<string, string> = {}) {
  const s = setup(files);
  for (const name of ['resume-guide.md', 'cover-letter-guide.md']) copyFileSync(join(REAL_STARTERS, 'profile', name), join(s.startersDir, 'profile', name));
  for (const name of ['resume.css', 'cover-letter.css']) copyFileSync(join(REAL_STARTERS, 'templates', name), join(s.startersDir, 'templates', name));
  return s;
}


describe('syncStarters: an earlier starter guide you never changed', () => {
  it('has three earlier versions of each guide to test with', () => {
    expect(EARLIER.map((e) => e.file)).toEqual([
      'cover-letter-guide.5ac1b81.md',
      'cover-letter-guide.67c19c5.md',
      'cover-letter-guide.75011e0.md',
      'resume-guide.5ac1b81.md',
      'resume-guide.67c19c5.md',
      'resume-guide.75011e0.md',
    ]);
  });

  it.each(EARLIER.flatMap((e) => [{ ...e, bom: false }, { ...e, bom: true }]))(
    '$file with Windows line endings (byte-order mark: $bom) is replaced by the new starter, and its old text kept',
    ({ file, name, bom }) => {
      const { dir, startersDir, profile } = setupWithRealStarters();
      const old = `${bom ? '\uFEFF' : ''}${crlf(readFileSync(join(FIXTURES, file), 'utf8'))}`;
      writeFileSync(join(dir, `${name}.md`), old);

      const { copied, updated } = profile.syncStarters();
      expect(updated).toEqual([name]);
      expect(copied).not.toContain(name);
      // The starter file's own bytes.
      const starter = readFileSync(join(startersDir, 'profile', `${name}.md`));
      expect(readFileSync(join(dir, `${name}.md`)).equals(starter)).toBe(true);
      expect(oldVersions(dir)).toEqual([`${name}-${STAMP}.md`]);
      expect(readFileSync(join(dir, 'old-versions', `${name}-${STAMP}.md`), 'utf8')).toBe(old);
      expect(seen(dir)[name]).toBe(sha256(starter.toString('utf8')));
      expect(profile.starters().find((s) => s.name === name)).toEqual({ name, state: 'same', diff: null });
      // Nothing more to do at the next start.
      expect(profile.syncStarters()).toEqual({ copied: [], updated: [], failed: [] });
      expect(oldVersions(dir)).toHaveLength(1);
    },
  );

  it.each(EARLIER)('$file with one character changed is left alone', ({ file, name }) => {
    const { dir, profile } = setupWithRealStarters();
    const old = crlf(readFileSync(join(FIXTURES, file), 'utf8'));
    const changed = old.replace('e', 'E');
    expect(changed).not.toBe(old);
    writeFileSync(join(dir, `${name}.md`), changed);

    expect(profile.syncStarters().updated).toEqual([]);
    expect(readFileSync(join(dir, `${name}.md`), 'utf8')).toBe(changed);
    expect(oldVersions(dir)).toEqual([]);
    expect(seen(dir)[name]).toBeUndefined();
    expect(profile.starters().find((s) => s.name === name)?.state).toBe('newer');
  });

  it('leaves the current starter with Windows line endings as it is, and records it', () => {
    const { dir, profile } = setupWithRealStarters();
    const mine = crlf(readFileSync(join(REAL_STARTERS, 'profile', 'resume-guide.md'), 'utf8'));
    writeFileSync(join(dir, 'resume-guide.md'), mine);

    expect(profile.syncStarters().updated).toEqual([]);
    expect(readFileSync(join(dir, 'resume-guide.md'), 'utf8')).toBe(mine);
    expect(oldVersions(dir)).toEqual([]);
    expect(seen(dir)['resume-guide']).toBe(sha256(mine));
  });

  it('a broken record of what you have seen reads as no record, and never stops the start', () => {
    const { dir, profile } = setupWithRealStarters({ 'profile/.starter-versions.json': '{ not json', 'profile/cover-letter-guide.md': 'My own guide.\n' });
    expect(profile.syncStarters()).toEqual({ copied: ['resume-guide', 'resume', 'cover-letter'], updated: [], failed: [] });
    expect(profile.starters().find((s) => s.name === 'cover-letter-guide')?.state).toBe('newer');
    expect(Object.keys(seen(dir))).toEqual(['resume-guide']);
  });

  it.each(EARLIER)('$file put back by hand after the update is yours, and is never replaced again', ({ file, name }) => {
    const { dir, profile } = setupWithRealStarters();
    const old = crlf(readFileSync(join(FIXTURES, file), 'utf8'));
    writeFileSync(join(dir, `${name}.md`), old);
    expect(profile.syncStarters().updated).toEqual([name]);

    writeFileSync(join(dir, `${name}.md`), old);
    expect(profile.syncStarters()).toEqual({ copied: [], updated: [], failed: [] });
    expect(readFileSync(join(dir, `${name}.md`), 'utf8')).toBe(old);
    expect(oldVersions(dir)).toHaveLength(1);
    expect(profile.starters().find((s) => s.name === name)).toEqual({ name, state: 'yours', diff: null });
  });

  it('an earlier starter without its final line break is still the earlier starter', () => {
    const old = readFileSync(join(FIXTURES, 'resume-guide.75011e0.md'), 'utf8');
    const { profile } = setupWithRealStarters({ 'profile/resume-guide.md': old.trimEnd() });
    expect(profile.syncStarters().updated).toEqual(['resume-guide']);
  });

  it("a guide that can't be updated is left as it was, and the start goes on", () => {
    const old = crlf(readFileSync(join(FIXTURES, 'resume-guide.75011e0.md'), 'utf8'));
    // A file where the old-versions folder goes, so the old text can't be kept.
    const { dir, profile, events } = setupWithRealStarters({ 'profile/old-versions': 'not a folder', 'profile/resume-guide.md': old });

    const { copied, updated, failed } = profile.syncStarters();
    expect(updated).toEqual([]);
    expect(failed).toEqual([{ name: 'resume-guide', err: expect.any(Error) }]);
    expect(copied).toEqual(['cover-letter-guide', 'resume', 'cover-letter']);
    expect(readFileSync(join(dir, 'resume-guide.md'), 'utf8')).toBe(old);
    expect(seen(dir)).toEqual({ 'cover-letter-guide': expect.any(String) });
    // Settings still offers the new guide; Use the new guide can't keep the old text either, so it changes nothing.
    expect(profile.starters()[0]?.state).toBe('newer');
    expect(() => profile.useStarter('resume-guide')).toThrow();
    expect(readFileSync(join(dir, 'resume-guide.md'), 'utf8')).toBe(old);
    expect(events).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it("a starter that can't be copied in is left out, and the start goes on", () => {
    const { dir, profile } = setupWithRealStarters();
    // A folder where the copy's temporary file goes.
    mkdirSync(join(dir, `resume-guide.md.${NOW.getTime()}.tmp`));
    const { copied, failed } = profile.syncStarters();
    expect(failed).toEqual([{ name: 'resume-guide', err: expect.any(Error) }]);
    expect(copied).toEqual(['cover-letter-guide', 'resume', 'cover-letter']);
    expect(existsSync(join(dir, 'resume-guide.md'))).toBe(false);
  });

  it("a record that can't be written never stops the start, and leaves no temporary file", () => {
    const old = readFileSync(join(FIXTURES, 'resume-guide.75011e0.md'), 'utf8');
    const { dir, profile } = setupWithRealStarters({ 'profile/resume-guide.md': old, 'profile/.starter-versions.json/x': 'a folder, not a file' });
    const { updated, failed } = profile.syncStarters();
    expect(updated).toEqual(['resume-guide']);
    expect(failed).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('starters: a newer starter guide', () => {
  const STARTER = '# Cover letters\n\nKeep it short.\nSay why.\n';
  const MINE = '# Cover letters\n\nMy own way.\n';
  const same = (text: string) => ({ kind: 'same', text });

  function withStarters(files: Record<string, string> = {}) {
    const s = setup(files);
    writeFileSync(join(s.startersDir, 'profile', 'cover-letter-guide.md'), STARTER);
    writeFileSync(join(s.startersDir, 'profile', 'resume-guide.md'), '# Resumes\n');
    return s;
  }

  it('is the same when your guide is the starter, even with Windows line endings', () => {
    const { dir, profile } = withStarters();
    profile.syncStarters();
    expect(profile.starters()).toEqual([
      { name: 'resume-guide', state: 'same', diff: null },
      { name: 'cover-letter-guide', state: 'same', diff: null },
    ]);
    writeFileSync(join(dir, 'cover-letter-guide.md'), crlf(STARTER));
    expect(profile.starters()[1]).toEqual({ name: 'cover-letter-guide', state: 'same', diff: null });
    writeFileSync(join(dir, 'cover-letter-guide.md'), STARTER.trimEnd());
    expect(profile.starters()[1]).toEqual({ name: 'cover-letter-guide', state: 'same', diff: null });
  });

  it('normaliseStarter drops a byte-order mark, Windows and old Mac line endings, and the final line break', () => {
    expect(normaliseStarter(`${String.fromCharCode(0xfeff)}a\r\nb\rc\r\n`)).toBe('a\nb\nc');
    expect(normaliseStarter('a\n\n')).toBe('a\n');
    expect(normaliseStarter('a')).toBe('a');
  });

  it("is newer when your guide differs and there's no record, with a line-by-line diff to the starter", () => {
    const { profile } = withStarters({ 'profile/cover-letter-guide.md': MINE });
    const status = profile.starters().find((s) => s.name === 'cover-letter-guide');
    expect(status).toEqual({
      name: 'cover-letter-guide',
      state: 'newer',
      diff: [same('# Cover letters'), same(''), { kind: 'removed', text: 'My own way.' }, { kind: 'added', text: 'Keep it short.' }, { kind: 'added', text: 'Say why.' }],
    });
    // Leave out the removed lines and you have the starter.
    expect(status!.diff!.filter((l) => l.kind !== 'removed').map((l) => l.text)).toEqual(STARTER.trimEnd().split('\n'));
  });

  it('a missing guide is newer, with the whole starter as added lines', () => {
    const { profile } = withStarters();
    expect(profile.starters()[1]).toEqual({
      name: 'cover-letter-guide',
      state: 'newer',
      diff: STARTER.trimEnd().split('\n').map((text) => ({ kind: 'added', text })),
    });
  });

  it('Keep mine on a missing guide is remembered too', () => {
    const { profile } = withStarters();
    expect(profile.keepStarter('cover-letter-guide')).toEqual({ name: 'cover-letter-guide', state: 'yours', diff: null });
    expect(profile.starters()[1]).toEqual({ name: 'cover-letter-guide', state: 'yours', diff: null });
  });

  it('Keep mine remembers the starter you have seen, until a newer one comes', () => {
    const { dir, startersDir, profile, events } = withStarters({ 'profile/cover-letter-guide.md': MINE });
    expect(profile.keepStarter('cover-letter-guide')).toEqual({ name: 'cover-letter-guide', state: 'yours', diff: null });
    expect(profile.starters()[1]).toEqual({ name: 'cover-letter-guide', state: 'yours', diff: null });
    expect(seen(dir)).toEqual({ 'cover-letter-guide': sha256(STARTER) });
    expect(readFileSync(join(dir, 'cover-letter-guide.md'), 'utf8')).toBe(MINE);
    expect(oldVersions(dir)).toEqual([]);
    expect(events).toEqual([]);

    writeFileSync(join(startersDir, 'profile', 'cover-letter-guide.md'), `${STARTER}Be kind.\n`);
    expect(profile.starters()[1]?.state).toBe('newer');
  });

  it('Use the new guide keeps your old text and puts the starter in', () => {
    const { dir, profile, events } = withStarters({ 'profile/cover-letter-guide.md': crlf(MINE) });
    const file = profile.useStarter('cover-letter-guide');
    expect(file).toEqual({ name: 'cover-letter-guide', text: STARTER, updatedAt: expect.any(String) });
    expect(readFileSync(join(dir, 'cover-letter-guide.md'), 'utf8')).toBe(STARTER);
    expect(oldVersions(dir)).toEqual([`cover-letter-guide-${STAMP}.md`]);
    expect(readFileSync(join(dir, 'old-versions', `cover-letter-guide-${STAMP}.md`), 'utf8')).toBe(crlf(MINE));
    expect(seen(dir)).toEqual({ 'cover-letter-guide': sha256(STARTER) });
    expect(events).toEqual([['profile.changed', { name: 'cover-letter-guide' }]]);
    expect(profile.starters()[1]).toEqual({ name: 'cover-letter-guide', state: 'same', diff: null });
  });
});

describe('appendAnswers: answers from my applications, in the master profile', () => {
  const HEADING = '## Answers from my applications';
  const NO_PROFILE = 'Add your master profile first: Settings → Profile.';

  function withProfile(text: string) {
    const s = setup({ 'profile/master-profile.md': text });
    return { ...s, text: () => readFileSync(join(s.dir, 'master-profile.md'), 'utf8') };
  }

  it('adds a blank line, the heading and the lines at the end when the heading is not there', () => {
    const before = '# Sam Taylor\n\n## Skills\n- TypeScript\n';
    const { dir, profile, events, text } = withProfile(before);
    const file = profile.appendAnswers(['- a', '- b']);
    const after = `${before}\n${HEADING}\n- a\n- b\n`;
    expect(text()).toBe(after);
    expect(file).toEqual({ name: 'master-profile', text: after, updatedAt: expect.any(String) });
    expect(oldVersions(dir)).toEqual([`master-profile-${STAMP}.md`]);
    expect(readFileSync(join(dir, 'old-versions', `master-profile-${STAMP}.md`), 'utf8')).toBe(before);
    expect(events).toEqual([['profile.changed', { name: 'master-profile' }]]);
  });

  it('adds the lines at the end of the section when the heading is there, before the next heading', () => {
    const top = '# Sam Taylor\n\nIntro.\n\n';
    const section = `${HEADING}\n- 1 Oct 2026, Engineer at Example Co: Can you drive? Yes.\n### Still this section\n- old\n`;
    const rest = '\n## Skills\n- TypeScript\n\n# Other\nText\n';
    const { profile, text } = withProfile(`${top}${section}${rest}`);
    profile.appendAnswers(['- a', '- b']);
    expect(text()).toBe(`${top}${section}- a\n- b\n${rest}`);
  });

  it('a heading of level 1 ends the section too, and a heading with no lines under it gets them straight after', () => {
    const { profile, text } = withProfile(`${HEADING}\n\n# Next\n`);
    profile.appendAnswers(['- a']);
    expect(text()).toBe(`${HEADING}\n- a\n\n# Next\n`);
  });

  it.each([
    ['with no space after the marks', '##Answers from my applications'],
    ['in another case', '## answers FROM my Applications'],
    ['with spaces after it', '## Answers from my applications   '],
    ['as a heading of level 1', '# Answers from my applications'],
  ])('finds the heading %s, and a heading with no space after its marks ends the section', (_, heading) => {
    const top = `# Sam Taylor\n\n${heading}\n- old\n`;
    const rest = '\n##Skills\n- TypeScript\n';
    const { profile, text } = withProfile(`${top}${rest}`);
    profile.appendAnswers(['- a']);
    expect(text()).toBe(`${top}- a\n${rest}`);
  });

  it("changes nothing when the old version can't be kept", () => {
    const { dir, profile, events, text } = withProfile('# Sam Taylor\n');
    writeFileSync(join(dir, 'old-versions'), 'not a folder');
    expect(() => profile.appendAnswers(['- a'])).toThrow();
    expect(text()).toBe('# Sam Taylor\n');
    expect(events).toEqual([]);
  });

  it("keeps the file's own Windows line endings and byte-order mark", () => {
    const top = '\uFEFF# Sam Taylor\r\n\r\n';
    const { profile, text } = withProfile(`${top}${HEADING}\r\n- old\r\n\r\n## Skills\r\n- TS\r\n`);
    profile.appendAnswers(['- a', '- b']);
    expect(text()).toBe(`${top}${HEADING}\r\n- old\r\n- a\r\n- b\r\n\r\n## Skills\r\n- TS\r\n`);

    const first = withProfile('\uFEFF# Sam Taylor\r\n');
    first.profile.appendAnswers(['- a']);
    expect(first.text()).toBe(`\uFEFF# Sam Taylor\r\n\r\n${HEADING}\r\n- a\r\n`);
  });

  it('works when the file has no line break at its end, and adds no second blank line', () => {
    const none = withProfile('# Sam Taylor');
    none.profile.appendAnswers(['- a']);
    expect(none.text()).toBe(`# Sam Taylor\n\n${HEADING}\n- a`);

    const last = withProfile(`# Sam Taylor\n\n${HEADING}\n- old`);
    last.profile.appendAnswers(['- a']);
    expect(last.text()).toBe(`# Sam Taylor\n\n${HEADING}\n- old\n- a`);

    const blank = withProfile('# Sam Taylor\n\n');
    blank.profile.appendAnswers(['- a']);
    expect(blank.text()).toBe(`# Sam Taylor\n\n${HEADING}\n- a\n`);
  });

  it('a line break inside a line becomes a space, so a line can never start a heading of its own', () => {
    const { profile, text } = withProfile('# Sam Taylor\n');
    profile.appendAnswers(['- a\n## Not mine', '- b\r\nmore']);
    expect(text()).toBe(`# Sam Taylor\n\n${HEADING}\n- a ## Not mine\n- b more\n`);
  });

  it("answerLines gives the section's lines that aren't blank, and nothing from the next section", () => {
    const { profile } = withProfile(
      `\uFEFF# Sam Taylor\r\n\r\n${HEADING}\r\n- 1 Oct 2026, Engineer at Example Co: Can you drive? Yes.\r\n\r\n### Still this section\r\n- old\r\n\r\n## Skills\r\n- TypeScript\r\n`,
    );
    expect(profile.answerLines()).toEqual(['- 1 Oct 2026, Engineer at Example Co: Can you drive? Yes.', '### Still this section', '- old']);
    profile.appendAnswers(['- a']);
    expect(profile.answerLines().at(-1)).toBe('- a');
    expect(withProfile('# Sam Taylor\n\n## Skills\n- TypeScript\n').profile.answerLines()).toEqual([]);
    expect(setup().profile.answerLines()).toEqual([]);
  });

  it('an empty list changes nothing and keeps no copy', () => {
    const { dir, profile, events, text } = withProfile('# Sam Taylor\n');
    expect(profile.appendAnswers([]).text).toBe('# Sam Taylor\n');
    expect(text()).toBe('# Sam Taylor\n');
    expect(oldVersions(dir)).toEqual([]);
    expect(events).toEqual([]);
  });

  it('needs a master profile', () => {
    for (const { profile } of [setup(), withProfile('  \n')]) {
      expect(() => profile.appendAnswers(['- a'])).toThrow(ValidationError);
      expect(() => profile.appendAnswers(['- a'])).toThrow(NO_PROFILE);
    }
  });

  it('names each old version by the local time, with -2 and -3 when that name is taken', () => {
    const { dir, profile } = withProfile('v1\n');
    for (const line of ['- a', '- b', '- c']) profile.appendAnswers([line]);
    const old = (name: string) => readFileSync(join(dir, 'old-versions', name), 'utf8');
    expect(old(`master-profile-${STAMP}.md`)).toBe('v1\n');
    expect(old(`master-profile-${STAMP}-2.md`)).toBe(`v1\n\n${HEADING}\n- a\n`);
    expect(old(`master-profile-${STAMP}-3.md`)).toBe(`v1\n\n${HEADING}\n- a\n- b\n`);
    expect(oldVersions(dir)).toHaveLength(3);
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

  it("PUT with the updatedAt the editor loaded is a 409 when the file changed since, and saves when it hasn't", async () => {
    const path = join(app.root, 'profile', 'master-profile.md');
    writeFileSync(path, '# Sam Taylor\n');
    utimesSync(path, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
    const loaded = (await app.request('GET', '/api/v1/profile/master-profile')).body;
    app.services.profile.appendAnswers(['- 3 Nov 2026: Have you used Go? Yes.']);

    const stale = await app.request('PUT', '/api/v1/profile/master-profile', { text: '# Sam Taylor\nMy edit.\n', updatedAt: loaded.updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toEqual({
      code: 'conflict',
      message: 'This file changed since you opened it. Reload the page to see the new text, then make your change again.',
    });
    expect(readFileSync(path, 'utf8')).toContain('Have you used Go? Yes.');

    const fresh = (await app.request('GET', '/api/v1/profile/master-profile')).body;
    const saved = await app.request('PUT', '/api/v1/profile/master-profile', { text: `${fresh.text}My edit.\n`, updatedAt: fresh.updatedAt });
    expect(saved.status).toBe(200);
    expect(saved.body.text).toContain('Have you used Go? Yes.\nMy edit.\n');
    expect((await app.request('PUT', '/api/v1/profile/master-profile', { text: 'x', updatedAt: 'yesterday' })).status).toBe(400);
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
