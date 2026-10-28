// All SQL for the contacts, job_contacts and interactions tables.

import {
  Contact,
  Interaction,
  JobContact,
  type InteractionKind,
  type Relation,
} from '../../../shared/contracts/index.ts';
import type { Db } from '../../core/db/db.ts';

export type ContactFields = {
  name: string;
  role: string | null;
  organisation: string | null;
  email: string | null;
  phone: string | null;
  phoneDigits: string;
  linkedinUrl: string | null;
  notes: string | null;
};

type Row = Record<string, unknown>;

const COLUMNS: Record<keyof ContactFields, string> = {
  name: 'name',
  role: 'role',
  organisation: 'organisation',
  email: 'email',
  phone: 'phone',
  phoneDigits: 'phone_digits',
  linkedinUrl: 'linkedin_url',
  notes: 'notes',
};

function toContact(r: Row): Contact {
  return Contact.parse({
    id: r.id,
    name: r.name,
    role: r.role,
    organisation: r.organisation,
    email: r.email,
    phone: r.phone,
    linkedinUrl: r.linkedin_url,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}

function toInteraction(r: Row): Interaction {
  return Interaction.parse({
    id: r.id,
    contactId: r.contact_id,
    contactName: r.contact_name ?? null,
    jobId: r.job_id,
    kind: r.kind,
    happenedAt: r.happened_at,
    notes: r.notes,
  });
}

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, '\\$&');

const INTERACTION_SELECT = `SELECT i.*, c.name AS contact_name FROM interactions i LEFT JOIN contacts c ON c.id = i.contact_id`;

export function createContactsRepo(db: Db) {
  return {
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    insertContact(fields: ContactFields, at: string): number {
      const cols = Object.fromEntries(Object.entries(fields).map(([k, v]) => [COLUMNS[k as keyof ContactFields], v]));
      const all = { ...cols, created_at: at, updated_at: at };
      const names = Object.keys(all);
      const sql = `INSERT INTO contacts (${names.join(', ')}) VALUES (${names.map((n) => `@${n}`).join(', ')})`;
      return Number(db.prepare(sql).run(all).lastInsertRowid);
    },

    updateContact(id: number, fields: Partial<ContactFields>, at: string): void {
      const cols: Record<string, unknown> = { updated_at: at };
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) cols[COLUMNS[key as keyof ContactFields]] = value;
      }
      const sets = Object.keys(cols).map((n) => `${n} = @${n}`);
      db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = @id`).run({ ...cols, id });
    },

    getContact(id: number): Contact | undefined {
      const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Row | undefined;
      return row ? toContact(row) : undefined;
    },

    search(text: string | null, digits: string | null, limit: number): Contact[] {
      const where: string[] = [];
      const params: Record<string, unknown> = { limit };
      if (text) {
        params.like = `%${escapeLike(text)}%`;
        where.push("name LIKE @like ESCAPE '\\'", "organisation LIKE @like ESCAPE '\\'", "email LIKE @like ESCAPE '\\'");
      }
      if (digits) {
        params.digits = digits;
        where.push("(phone_digits != '' AND phone_digits LIKE '%' || @digits || '%')");
      }
      const filter = where.length > 0 ? `WHERE ${where.join(' OR ')}` : '';
      const rows = db.prepare(`SELECT * FROM contacts ${filter} ORDER BY name COLLATE NOCASE, id LIMIT @limit`).all(params);
      return (rows as Row[]).map(toContact);
    },

    listIds(): number[] {
      return (db.prepare('SELECT id FROM contacts ORDER BY id').all() as { id: number }[]).map((r) => r.id);
    },

    // Adds or updates the link. Returns true when the link is new.
    link(jobId: number, contactId: number, relation: Relation): boolean {
      const existed = db.prepare('SELECT 1 FROM job_contacts WHERE job_id = ? AND contact_id = ?').get(jobId, contactId);
      db.prepare(
        `INSERT INTO job_contacts (job_id, contact_id, relation) VALUES (?, ?, ?)
         ON CONFLICT (job_id, contact_id) DO UPDATE SET relation = excluded.relation`,
      ).run(jobId, contactId, relation);
      return !existed;
    },

    // Links only if not linked yet, keeping any existing relation. Returns true when new.
    ensureLink(jobId: number, contactId: number, relation: Relation): boolean {
      const result = db
        .prepare('INSERT OR IGNORE INTO job_contacts (job_id, contact_id, relation) VALUES (?, ?, ?)')
        .run(jobId, contactId, relation);
      return result.changes > 0;
    },

    unlink(jobId: number, contactId: number): void {
      db.prepare('DELETE FROM job_contacts WHERE job_id = ? AND contact_id = ?').run(jobId, contactId);
    },

    listForJob(jobId: number): JobContact[] {
      const rows = db
        .prepare(
          `SELECT c.*, jc.relation,
             (SELECT MAX(i.happened_at) FROM interactions i WHERE i.contact_id = c.id) AS last_at
           FROM job_contacts jc JOIN contacts c ON c.id = jc.contact_id
           WHERE jc.job_id = ?
           ORDER BY last_at IS NULL, last_at DESC, c.name COLLATE NOCASE`,
        )
        .all(jobId) as Row[];
      return rows.map((r) => JobContact.parse({ ...toContact(r), relation: r.relation, lastInteractionAt: r.last_at ?? null }));
    },

    listJobIds(contactId: number): number[] {
      const rows = db.prepare('SELECT job_id FROM job_contacts WHERE contact_id = ? ORDER BY job_id').all(contactId);
      return (rows as { job_id: number }[]).map((r) => r.job_id);
    },

    findByPhoneDigits(digits: string): { contactId: number; jobIds: number[] }[] {
      const rows = db
        .prepare(
          `SELECT c.id,
             (SELECT json_group_array(jc.job_id) FROM job_contacts jc WHERE jc.contact_id = c.id) AS job_ids
           FROM contacts c
           WHERE c.phone_digits != '' AND c.phone_digits LIKE '%' || ? || '%'
           ORDER BY c.id`,
        )
        .all(digits) as { id: number; job_ids: string }[];
      return rows.map((r) => ({ contactId: r.id, jobIds: JSON.parse(r.job_ids) as number[] }));
    },

    insertInteraction(i: {
      contactId: number | null;
      jobId: number | null;
      kind: InteractionKind;
      happenedAt: string;
      notes: string;
    }): number {
      return Number(
        db
          .prepare(
            'INSERT INTO interactions (contact_id, job_id, kind, happened_at, notes) VALUES (@contactId, @jobId, @kind, @happenedAt, @notes)',
          )
          .run(i).lastInsertRowid,
      );
    },

    getInteraction(id: number): Interaction | undefined {
      const row = db.prepare(`${INTERACTION_SELECT} WHERE i.id = ?`).get(id) as Row | undefined;
      return row ? toInteraction(row) : undefined;
    },

    listInteractionsForJob(jobId: number): Interaction[] {
      const rows = db.prepare(`${INTERACTION_SELECT} WHERE i.job_id = ? ORDER BY i.happened_at DESC, i.id DESC`).all(jobId);
      return (rows as Row[]).map(toInteraction);
    },
  };
}

export type ContactsRepo = ReturnType<typeof createContactsRepo>;
