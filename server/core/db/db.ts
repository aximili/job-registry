import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const DEFAULT_MIGRATIONS = fileURLToPath(new URL('./migrations/', import.meta.url));
const MIGRATION_FILE = /^(\d{3})_[\w-]+\.sql$/;

export type OpenDbOptions = {
  migrationsDir?: string;
  // Called before migrating a database that already has data, so it can be backed up first.
  onBeforeMigrate?: (db: Db) => void;
};

export function openDb(file: string, opts: OpenDbOptions = {}): Db {
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db, opts.migrationsDir ?? DEFAULT_MIGRATIONS, { onBeforeMigrate: opts.onBeforeMigrate });
  return db;
}

// Applies every NNN_*.sql file newer than PRAGMA user_version, in order,
// each in its own transaction. Never edit a migration once it has run.
export function migrate(
  db: Db,
  dir: string,
  opts: { onBeforeMigrate?: (db: Db) => void } = {},
): { from: number; to: number } {
  const from = db.pragma('user_version', { simple: true }) as number;
  const pending = readdirSync(dir)
    .flatMap((name) => {
      const match = MIGRATION_FILE.exec(name);
      return match ? [{ name, version: Number(match[1]) }] : [];
    })
    .filter((m) => m.version > from)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) return { from, to: from };
  if (from > 0) opts.onBeforeMigrate?.(db);

  let to = from;
  for (const step of pending) {
    const sql = readFileSync(join(dir, step.name), 'utf8');
    try {
      db.transaction(() => {
        db.exec(sql);
        db.pragma(`user_version = ${step.version}`);
      })();
    } catch (err) {
      throw new Error(`Database migration ${step.name} failed: ${(err as Error).message}`, { cause: err });
    }
    to = step.version;
  }
  return { from, to };
}

export function isConstraintError(err: unknown, kind: 'FOREIGNKEY' | 'UNIQUE'): boolean {
  return err instanceof Database.SqliteError && err.code === `SQLITE_CONSTRAINT_${kind}`;
}
