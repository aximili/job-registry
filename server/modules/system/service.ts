import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Health } from '../../../shared/contracts/index.ts';
import type { Clock } from '../../core/config.ts';
import type { Db } from '../../core/db/db.ts';
import type { Logger } from '../../core/logger.ts';

export interface SystemService {
  health(): Health;
  backupNow(): Promise<string>;
  startDailyBackups(): () => void;
}

export type SystemOptions = {
  db: Db;
  backupDir: () => string;
  keepBackups: () => number;
  now: Clock;
  version: string;
  logger: Logger;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_FILE = /^jobs-\d{4}-\d{2}-\d{2}-\d{6}\.db$/;

export function createSystemService(opts: SystemOptions): SystemService {
  const startedAt = opts.now().getTime();

  async function backupNow(): Promise<string> {
    const dir = opts.backupDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `jobs-${stamp(opts.now())}.db`);
    // SQLite's online backup: safe while the app is running. It goes to a
    // temporary file first, so a backup cut short (the window closed, power
    // lost) is never mistaken for a good one.
    const partial = `${file}.tmp`;
    await opts.db.backup(partial);
    renameSync(partial, file);
    pruneBackups(dir, opts.keepBackups());
    return file;
  }

  return {
    health: () => ({
      ok: true,
      version: opts.version,
      uptimeSec: Math.round((opts.now().getTime() - startedAt) / 1000),
    }),
    backupNow,
    startDailyBackups() {
      const timer = setInterval(() => {
        backupNow().catch((err: unknown) => opts.logger.error({ err }, 'The daily backup failed'));
      }, DAY_MS);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}

// Keeps the newest `keep` backups (file names sort by time), and removes
// any half-written ones left by an earlier crash.
function pruneBackups(dir: string, keep: number): void {
  for (const name of readdirSync(dir)) if (name.endsWith('.db.tmp')) rmSync(join(dir, name), { force: true });
  const backups = readdirSync(dir)
    .filter((name) => BACKUP_FILE.test(name))
    .sort()
    .reverse();
  for (const name of backups.slice(keep)) rmSync(join(dir, name));
}

const pad = (n: number): string => String(n).padStart(2, '0');

// Local time, YYYY-MM-DD-HHmmss.
function stamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
