import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { pruneLogs } from './logger.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('pruneLogs deletes app-*.log older than 14 days only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jr-logs-'));
  dirs.push(dir);
  for (const name of ['app-2026-10-01.log', 'app-2026-10-13.log', 'app-2026-10-14.log', 'app-2026-10-28.log', 'llama.log']) {
    writeFileSync(join(dir, name), 'x');
  }
  const deleted = pruneLogs(dir, 14, new Date('2026-10-28T03:00:00Z'));
  expect(deleted.sort()).toEqual(['app-2026-10-01.log', 'app-2026-10-13.log']);
  expect(readdirSync(dir).sort()).toEqual(['app-2026-10-14.log', 'app-2026-10-28.log', 'llama.log']);
});
