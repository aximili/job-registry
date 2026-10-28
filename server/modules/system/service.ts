import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import type { Health } from '../../../shared/contracts/index.ts';
import type { Clock } from '../../core/config.ts';
import type { Db } from '../../core/db/db.ts';
import { replaceFile } from '../../core/files.ts';
import type { Logger } from '../../core/logger.ts';

export interface SystemService {
  health(): Health;
  backupNow(): Promise<string>;
  startDailyBackups(): () => void;
}

export type SystemOptions = {
  db: Db;
  backupDir: () => string;
  // Folders copied into the backup folder too: your attached files (data/files),
  // and your profile and templates, which git never keeps.
  filesDir: string;
  profileDir: string;
  templatesDir: string;
  keepBackups: () => number;
  now: Clock;
  version: string;
  logger: Logger;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_FILE = /^jobs-\d{4}-\d{2}-\d{2}-\d{6}\.db$/;

export function createSystemService(opts: SystemOptions): SystemService {
  const startedAt = opts.now().getTime();

  // One backup at a time. Asking again while one runs (a double click on
  // "Back up now", or the daily timer) gets that same backup.
  let running: Promise<string> | null = null;

  function backupNow(): Promise<string> {
    running ??= backupOnce().finally(() => {
      running = null;
    });
    return running;
  }

  async function backupOnce(): Promise<string> {
    const dir = opts.backupDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `jobs-${stamp(opts.now())}.db`);
    // SQLite's online backup: safe while the app is running. It goes to a
    // temporary file first, so a backup cut short (the window closed, power
    // lost) is never mistaken for a good one.
    const partial = `${file}.tmp`;
    await opts.db.backup(partial);
    replaceFile(partial, file);
    pruneBackups(dir, opts.keepBackups());
    // The database is backed up already: a file that can't be copied is logged and skipped.
    const failed = (err: unknown, file: string) => opts.logger.error({ err, file }, 'Copying a file to the backup folder failed');
    mirrorFiles(opts.filesDir, join(dir, 'files'), failed);
    mirrorFiles(opts.profileDir, join(dir, 'profile'), failed);
    mirrorFiles(opts.templatesDir, join(dir, 'templates'), failed);
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

// Keeps the newest backup from each of the last `keep` days that have one,
// and removes any half-written ones left by an earlier crash. Counting days
// that have a backup, not calendar days, means a long break never empties
// the folder. File names sort by time, and start with the local date.
function pruneBackups(dir: string, keep: number): void {
  for (const name of readdirSync(dir)) if (name.endsWith('.db.tmp')) rmSync(join(dir, name), { force: true });
  const backups = readdirSync(dir)
    .filter((name) => BACKUP_FILE.test(name))
    .sort()
    .reverse();
  const days = new Set<string>();
  for (const name of backups) {
    const day = name.slice('jobs-'.length, 'jobs-YYYY-MM-DD'.length);
    if (days.has(day) || days.size >= keep) rmSync(join(dir, name));
    days.add(day);
  }
}

// Copies new and changed files into the backup, keeping the folders. Nothing
// in the backup is ever deleted, so a file removed by mistake is still there.
function mirrorFiles(from: string, to: string, failed: (err: unknown, file: string) => void): void {
  if (!existsSync(from)) return;
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    try {
      if (entry.isDirectory()) {
        mirrorFiles(source, target, failed);
        continue;
      }
      if (!entry.isFile()) continue;
      const s = statSync(source);
      if (existsSync(target)) {
        const t = statSync(target);
        // File systems keep times to different precision (FAT and OneDrive to 2 seconds).
        if (t.isFile() && t.size === s.size && Math.abs(t.mtimeMs - s.mtimeMs) < 2000) continue;
      }
      mkdirSync(to, { recursive: true });
      copyFileSync(source, target);
      // The original's time, to the fraction, so the next backup can tell it's unchanged.
      utimesSync(target, s.atimeMs / 1000, s.mtimeMs / 1000);
    } catch (err) {
      failed(err, source);
    }
  }
}

const pad = (n: number): string => String(n).padStart(2, '0');

// Local time, YYYY-MM-DD-HHmmss.
function stamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
