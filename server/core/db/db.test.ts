import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate, openDb } from './db.ts';

const realMigrations = fileURLToPath(new URL('./migrations/', import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jr-db-'));
  dirs.push(dir);
  return dir;
}

function tableNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );
}

describe('database', () => {
  it('migrates an empty database to version 1 with all tables', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    const names = tableNames(db);
    for (const t of ['jobs', 'postings', 'status_history', 'notes', 'contacts', 'job_contacts', 'interactions', 'search_index']) {
      expect(names).toContain(t);
    }
  });

  it('does nothing on a second run', () => {
    const db = openDb(':memory:');
    expect(migrate(db, realMigrations)).toEqual({ from: 1, to: 1 });
  });

  it('rolls back a failing migration and names the file', () => {
    const db = new Database(':memory:');
    migrate(db, realMigrations);
    const dir = tempDir();
    copyFileSync(join(realMigrations, '001_init.sql'), join(dir, '001_init.sql'));
    writeFileSync(join(dir, '002_bad.sql'), 'CREATE TABLE half_done (id INTEGER);\nTHIS IS NOT SQL;');
    expect(() => migrate(db, dir)).toThrow(/002_bad\.sql/);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(tableNames(db)).not.toContain('half_done');
  });

  it('calls onBeforeMigrate only when upgrading an existing database', () => {
    const dir = tempDir();
    const file = join(dir, 'jobs.db');
    const first = vi.fn();
    openDb(file, { onBeforeMigrate: first }).close();
    expect(first).not.toHaveBeenCalled();

    const migrations = tempDir();
    copyFileSync(join(realMigrations, '001_init.sql'), join(migrations, '001_init.sql'));
    writeFileSync(join(migrations, '002_more.sql'), 'CREATE TABLE more (id INTEGER);');
    const second = vi.fn();
    const db = openDb(file, { migrationsDir: migrations, onBeforeMigrate: second });
    expect(second).toHaveBeenCalledTimes(1);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    db.close();
  });
});
