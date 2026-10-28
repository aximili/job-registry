import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

it('backupNow writes jobs-YYYY-MM-DD-HHmmss.db and keeps only the newest N', async () => {
  let time = new Date('2026-10-28T03:15:00Z').getTime();
  app = await createTestApp({ now: () => new Date(time), settings: { backups: { dir: 'data/backups', keep: 2 } } });
  const files: string[] = [];
  for (let i = 0; i < 3; i++) {
    files.push(await app.services.system.backupNow());
    time += 60_000;
  }
  // 03:15 UTC is 14:15 in Sydney.
  expect(files[0]).toMatch(/jobs-2026-10-28-141500\.db$/);
  const kept = readdirSync(dirname(files[0]!)).sort();
  expect(kept).toEqual(['jobs-2026-10-28-141600.db', 'jobs-2026-10-28-141700.db']);
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
