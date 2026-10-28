import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pino, type Logger } from 'pino';
import { localDate } from '../../shared/dates.ts';
import type { Clock } from './config.ts';

export type { Logger };

// Logs go to the console, and to data/logs/app-YYYY-MM-DD.log when a folder is given.
export function createLogger(opts: { dir: string | null; level?: string; now?: Clock }): Logger {
  const level = opts.level ?? 'info';
  if (!opts.dir) return pino({ level });
  mkdirSync(opts.dir, { recursive: true });
  const today = localDate((opts.now ?? (() => new Date()))());
  const file = join(opts.dir, `app-${today}.log`);
  return pino(
    { level },
    pino.multistream([
      { stream: process.stdout, level },
      // Synchronous, so the last error line is never lost when the app exits on a start-up failure.
      { stream: pino.destination({ dest: file, mkdir: true, sync: true }), level },
    ]),
  );
}

const LOG_FILE = /^app-(\d{4}-\d{2}-\d{2})\.log$/;

// Deletes app logs older than keepDays. Other files in the folder are left alone.
export function pruneLogs(dir: string, keepDays: number, now: Date): string[] {
  if (!existsSync(dir)) return [];
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - keepDays);
  const cutoffDate = localDate(cutoff);
  const deleted: string[] = [];
  for (const name of readdirSync(dir)) {
    const match = LOG_FILE.exec(name);
    if (match?.[1] && match[1] < cutoffDate) {
      rmSync(join(dir, name));
      deleted.push(name);
    }
  }
  return deleted;
}
