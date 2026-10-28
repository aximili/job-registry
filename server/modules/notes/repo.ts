// All SQL for the notes table.

import { Note } from '../../../shared/contracts/index.ts';
import { isConstraintError, type Db } from '../../core/db/db.ts';
import { NotFoundError } from '../../core/errors.ts';

type Row = { id: number; job_id: number; body: string; created_at: string; updated_at: string };

const toNote = (r: Row): Note =>
  Note.parse({ id: r.id, jobId: r.job_id, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at });

export function createNotesRepo(db: Db) {
  return {
    insert(jobId: number, body: string, at: string): Note {
      try {
        const id = Number(
          db
            .prepare('INSERT INTO notes (job_id, body, created_at, updated_at) VALUES (?, ?, ?, ?)')
            .run(jobId, body, at, at).lastInsertRowid,
        );
        return this.get(id)!;
      } catch (err) {
        if (isConstraintError(err, 'FOREIGNKEY')) throw new NotFoundError(`Job ${jobId} not found`);
        throw err;
      }
    },

    get(id: number): Note | undefined {
      const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined;
      return row ? toNote(row) : undefined;
    },

    update(id: number, body: string, at: string): void {
      db.prepare('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?').run(body, at, id);
    },

    remove(id: number): void {
      db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    },

    listForJob(jobId: number): Note[] {
      const rows = db.prepare('SELECT * FROM notes WHERE job_id = ? ORDER BY created_at DESC, id DESC').all(jobId) as Row[];
      return rows.map(toNote);
    },
  };
}

export type NotesRepo = ReturnType<typeof createNotesRepo>;
