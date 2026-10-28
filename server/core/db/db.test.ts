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

// Version 1 only: the database as Phase 1 left it.
function v1Migrations(): string {
  const dir = tempDir();
  copyFileSync(join(realMigrations, '001_init.sql'), join(dir, '001_init.sql'));
  return dir;
}

const LATEST = 2;

describe('database', () => {
  it('migrates an empty database to the latest version with all tables', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    const names = tableNames(db);
    for (const t of ['jobs', 'postings', 'status_history', 'notes', 'contacts', 'job_contacts', 'interactions', 'search_index', 'rating_cache']) {
      expect(names).toContain(t);
    }
  });

  it('does nothing on a second run', () => {
    const db = openDb(':memory:');
    expect(migrate(db, realMigrations)).toEqual({ from: LATEST, to: LATEST });
  });

  it('rolls back a failing migration and names the file', () => {
    const db = new Database(':memory:');
    const dir = v1Migrations();
    migrate(db, dir);
    writeFileSync(join(dir, '002_bad.sql'), 'CREATE TABLE half_done (id INTEGER);\nTHIS IS NOT SQL;');
    expect(() => migrate(db, dir)).toThrow(/002_bad\.sql/);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(tableNames(db)).not.toContain('half_done');
  });

  it('calls onBeforeMigrate only when upgrading an existing database', () => {
    const dir = tempDir();
    const file = join(dir, 'jobs.db');
    const first = vi.fn();
    const migrations = v1Migrations();
    openDb(file, { migrationsDir: migrations, onBeforeMigrate: first }).close();
    expect(first).not.toHaveBeenCalled();

    writeFileSync(join(migrations, '002_more.sql'), 'CREATE TABLE more (id INTEGER);');
    const second = vi.fn();
    const db = openDb(file, { migrationsDir: migrations, onBeforeMigrate: second });
    expect(second).toHaveBeenCalledTimes(1);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    db.close();
  });

  it('upgrades a version 1 database with data to the latest version, keeps the data and backs up first', () => {
    const file = join(tempDir(), 'jobs.db');
    const old = openDb(file, { migrationsDir: v1Migrations() });
    old
      .prepare("INSERT INTO jobs (title, status, created_at, updated_at) VALUES ('Engineer', 'saved', '2026-10-28T00:00:00Z', '2026-10-28T00:00:00Z')")
      .run();
    old.close();

    const backup = vi.fn();
    const db = openDb(file, { onBeforeMigrate: backup });
    expect(backup).toHaveBeenCalledTimes(1);
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST);
    expect(db.prepare('SELECT title FROM jobs').all()).toEqual([{ title: 'Engineer' }]);
    db.prepare("INSERT INTO rating_cache (ad_key, profile_hash, rating_json, created_at) VALUES ('k', 'h', '{}', 'now')").run();
    expect(db.prepare('SELECT ad_key FROM rating_cache').all()).toEqual([{ ad_key: 'k' }]);
    db.close();
  });
});
