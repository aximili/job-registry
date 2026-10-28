import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';

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
  const kept = readdirSync(dirname(files[0]!)).sort();
  expect(kept).toEqual(['jobs-2026-10-27-100000.db', 'jobs-2026-10-28-151500.db']);
});

it('two backups asked for at once share one backup instead of failing', async () => {
  app = await createTestApp({ now: () => new Date('2026-10-28T03:15:00Z') });
  const [a, b] = await Promise.all([app.services.system.backupNow(), app.services.system.backupNow()]);
  expect(a).toMatch(/jobs-2026-10-28-141500\.db$/);
  expect(b).toBe(a);
  expect(readdirSync(dirname(a)).sort()).toEqual(['jobs-2026-10-28-141500.db']);
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
  expect(readdirSync(dir).sort()).toEqual([file.split(/[\\/]/).pop()]);
});
