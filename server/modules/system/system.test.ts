import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';

// The backup folder's own files: the copied folders (files, profile, templates) aside.
const backupFiles = (dir: string) => readdirSync(dir).filter((name) => !['files', 'profile', 'templates'].includes(name));

let app: TestApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

it('backupNow writes jobs-YYYY-MM-DD-HHmmss.db and keeps the newest one from each of the last N days', async () => {
  let time = 0;
  app = await createTestApp({ now: () => new Date(time), settings: { backups: { dir: 'data/backups', keep: 2 } } });
  const files: string[] = [];
  // Several starts in one day must not push out the older days.
  // Sydney is 11 hours ahead of UTC in late October.
  for (const at of [
    '2026-10-25T22:00:00Z', // 26 Oct, 9 am
    '2026-10-26T22:00:00Z', // 27 Oct, 9 am
    '2026-10-26T23:00:00Z', // 27 Oct, 10 am
    '2026-10-28T03:15:00Z', // 28 Oct, 2:15 pm
    '2026-10-28T04:15:00Z', // 28 Oct, 3:15 pm
  ]) {
    time = new Date(at).getTime();
    files.push(await app.services.system.backupNow());
  }
  expect(files[3]).toMatch(/jobs-2026-10-28-141500\.db$/);
  const kept = backupFiles(dirname(files[0]!)).sort();
  expect(kept).toEqual(['jobs-2026-10-27-100000.db', 'jobs-2026-10-28-151500.db']);
});

it('two backups asked for at once share one backup instead of failing', async () => {
  app = await createTestApp({ now: () => new Date('2026-10-28T03:15:00Z') });
  const [a, b] = await Promise.all([app.services.system.backupNow(), app.services.system.backupNow()]);
  expect(a).toMatch(/jobs-2026-10-28-141500\.db$/);
  expect(b).toBe(a);
  expect(backupFiles(dirname(a)).sort()).toEqual(['jobs-2026-10-28-141500.db']);
});

it('POST /system/backup returns the file it wrote', async () => {
  app = await createTestApp();
  const res = await app.request('POST', '/api/v1/system/backup');
  expect(res.status).toBe(200);
  expect(res.body.file).toMatch(/jobs-\d{4}-\d{2}-\d{2}-\d{6}\.db$/);
});

it('writes each backup to a temporary file first, and cleans up any left by a crash', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  app = await createTestApp({ now: () => new Date('2026-10-28T03:15:00Z') });
  const dir = join(app.root, 'data', 'backups');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'jobs-2026-10-27-090000.db.tmp'), 'half a file');
  const file = await app.services.system.backupNow();
  expect(backupFiles(dir).sort()).toEqual([file.split(/[\\/]/).pop()]);
});

it('a backup also copies your attached files: new and changed ones, and never deletes', async () => {
  app = await createTestApp();
  const files = join(app.root, 'data', 'files');
  const copies = join(app.root, 'data', 'backups', 'files');
  mkdirSync(join(files, '1'), { recursive: true });
  writeFileSync(join(files, '1', 'a1b2c3d4-cv.pdf'), 'first');
  await app.services.system.backupNow();
  expect(readFileSync(join(copies, '1', 'a1b2c3d4-cv.pdf'), 'utf8')).toBe('first');

  writeFileSync(join(files, '1', 'a1b2c3d4-cv.pdf'), 'second, longer');
  writeFileSync(join(files, '1', 'e5f6a7b8-letter.docx'), 'letter');
  rmSync(join(files, '1', 'a1b2c3d4-cv.pdf'));
  writeFileSync(join(files, '1', 'a1b2c3d4-cv.pdf'), 'second, longer');
  await app.services.system.backupNow();
  expect(readFileSync(join(copies, '1', 'a1b2c3d4-cv.pdf'), 'utf8')).toBe('second, longer');
  expect(readFileSync(join(copies, '1', 'e5f6a7b8-letter.docx'), 'utf8')).toBe('letter');

  rmSync(join(files, '1', 'e5f6a7b8-letter.docx'));
  await app.services.system.backupNow();
  expect(existsSync(join(copies, '1', 'e5f6a7b8-letter.docx'))).toBe(true);
});

it('a backup with no attached files yet works, and makes no files folder', async () => {
  app = await createTestApp();
  await app.services.system.backupNow();
  expect(existsSync(join(app.root, 'data', 'backups', 'files'))).toBe(false);
});

it('a second backup leaves an unchanged attached file alone, and one bad file never stops the rest', async () => {
  app = await createTestApp();
  const files = join(app.root, 'data', 'files', '1');
  const copies = join(app.root, 'data', 'backups', 'files', '1');
  mkdirSync(files, { recursive: true });
  writeFileSync(join(files, 'a1b2c3d4-cv.pdf'), 'first');
  await app.services.system.backupNow();
  // Change the copy's text but not its size or time: an unchanged source must not be copied again.
  const before = statSync(join(copies, 'a1b2c3d4-cv.pdf'));
  writeFileSync(join(copies, 'a1b2c3d4-cv.pdf'), 'FIRST');
  utimesSync(join(copies, 'a1b2c3d4-cv.pdf'), before.atimeMs / 1000, before.mtimeMs / 1000);
  // A file the backup can't write (a folder in its place) is skipped, and the next one is still copied.
  writeFileSync(join(files, '0000aaaa-locked.pdf'), 'locked');
  mkdirSync(join(copies, '0000aaaa-locked.pdf'));
  writeFileSync(join(files, 'ffff0000-new.pdf'), 'new');
  await app.services.system.backupNow();
  expect(readFileSync(join(copies, 'a1b2c3d4-cv.pdf'), 'utf8')).toBe('FIRST');
  expect(readFileSync(join(copies, 'ffff0000-new.pdf'), 'utf8')).toBe('new');
});

it('a backup also copies your profile and templates, which git never keeps', async () => {
  app = await createTestApp();
  app.services.profile.write('master-profile', '# Sam Taylor');
  await app.services.system.backupNow();
  const backups = join(app.root, 'data', 'backups');
  expect(readFileSync(join(backups, 'profile', 'master-profile.md'), 'utf8')).toBe('# Sam Taylor');
  expect(readFileSync(join(backups, 'templates', 'resume.css'), 'utf8')).toMatch(/@page/);
});
