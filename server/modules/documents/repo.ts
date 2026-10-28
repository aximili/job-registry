// All SQL for the documents and attachments tables. Document versions are
// only ever inserted. The one update marks a version as sent, once.

import {
  Attachment,
  Document,
  DocumentSummary,
  type AttachmentKind,
  type DocumentKind,
  type DocumentOrigin,
} from '../../../shared/contracts/index.ts';
import { isConstraintError, type Db } from '../../core/db/db.ts';
import { NotFoundError } from '../../core/errors.ts';

type DocRow = {
  id: number;
  job_id: number;
  kind: DocumentKind;
  version: number;
  markdown: string;
  origin: DocumentOrigin;
  copied_from_id: number | null;
  is_sent: number;
  sent_at: string | null;
  sent_css: string | null;
  created_at: string;
};

type AttachmentRow = {
  id: number;
  job_id: number;
  kind: AttachmentKind;
  file_name: string;
  stored_path: string;
  size_bytes: number;
  created_at: string;
};

const toAttachment = (r: AttachmentRow): Attachment =>
  Attachment.parse({ id: r.id, jobId: r.job_id, kind: r.kind, fileName: r.file_name, sizeBytes: r.size_bytes, createdAt: r.created_at });

export type NewAttachment = { jobId: number; kind: AttachmentKind; fileName: string; storedPath: string; sizeBytes: number; at: string };

const SUMMARY_COLUMNS = 'id, job_id, kind, version, origin, copied_from_id, is_sent, sent_at, created_at';

const summaryOf = (r: Omit<DocRow, 'markdown' | 'sent_css'>) => ({
  id: r.id,
  jobId: r.job_id,
  kind: r.kind,
  version: r.version,
  origin: r.origin,
  copiedFromId: r.copied_from_id,
  isSent: r.is_sent === 1,
  sentAt: r.sent_at,
  createdAt: r.created_at,
});

const toSummary = (r: Omit<DocRow, 'markdown' | 'sent_css'>): DocumentSummary => DocumentSummary.parse(summaryOf(r));
const toDocument = (r: DocRow): Document => Document.parse({ ...summaryOf(r), markdown: r.markdown, sentCss: r.sent_css });


export type NewDocument = {
  jobId: number;
  kind: DocumentKind;
  markdown: string;
  origin: DocumentOrigin;
  copiedFromId: number | null;
  at: string;
};

export function createDocumentsRepo(db: Db) {
  return {
    // The next version number for this job and kind, in the same transaction as the insert.
    insert(doc: NewDocument): Document {
      try {
        const id = db.transaction(() => {
          const { next } = db
            .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM documents WHERE job_id = ? AND kind = ?')
            .get(doc.jobId, doc.kind) as { next: number };
          return Number(
            db
              .prepare(
                'INSERT INTO documents (job_id, kind, version, markdown, origin, copied_from_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
              )
              .run(doc.jobId, doc.kind, next, doc.markdown, doc.origin, doc.copiedFromId, doc.at).lastInsertRowid,
          );
        })();
        return this.get(id)!;
      } catch (err) {
        if (isConstraintError(err, 'FOREIGNKEY')) throw new NotFoundError(`Job ${doc.jobId} not found`);
        throw err;
      }
    },

    get(id: number): Document | undefined {
      const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocRow | undefined;
      return row ? toDocument(row) : undefined;
    },

    listForJob(jobId: number): DocumentSummary[] {
      const rows = db
        .prepare(`SELECT ${SUMMARY_COLUMNS} FROM documents WHERE job_id = ? ORDER BY created_at DESC, id DESC`)
        .all(jobId) as DocRow[];
      return rows.map(toSummary);
    },

    listAll(kind: DocumentKind | undefined): DocumentSummary[] {
      const rows = (
        kind
          ? db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM documents WHERE kind = ? ORDER BY created_at DESC, id DESC`).all(kind)
          : db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM documents ORDER BY created_at DESC, id DESC`).all()
      ) as DocRow[];
      return rows.map(toSummary);
    },

    // Only a version not yet sent: a second call changes nothing.
    markSent(id: number, css: string, at: string): boolean {
      return db.prepare('UPDATE documents SET is_sent = 1, sent_at = ?, sent_css = ? WHERE id = ? AND is_sent = 0').run(at, css, id).changes > 0;
    },

    latestSent(jobId: number, kind: DocumentKind): DocumentSummary | null {
      const row = db
        .prepare(`SELECT ${SUMMARY_COLUMNS} FROM documents WHERE job_id = ? AND kind = ? AND is_sent = 1 ORDER BY sent_at DESC, id DESC LIMIT 1`)
        .get(jobId, kind) as DocRow | undefined;
      return row ? toSummary(row) : null;
    },

    insertAttachment(a: NewAttachment): Attachment {
      try {
        const id = Number(
          db
            .prepare('INSERT INTO attachments (job_id, kind, file_name, stored_path, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(a.jobId, a.kind, a.fileName, a.storedPath, a.sizeBytes, a.at).lastInsertRowid,
        );
        return this.getAttachment(id)!.attachment;
      } catch (err) {
        if (isConstraintError(err, 'FOREIGNKEY')) throw new NotFoundError(`Job ${a.jobId} not found`);
        throw err;
      }
    },

    getAttachment(id: number): { attachment: Attachment; storedPath: string } | undefined {
      const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined;
      return row ? { attachment: toAttachment(row), storedPath: row.stored_path } : undefined;
    },

    listAttachments(jobId: number): Attachment[] {
      const rows = db.prepare('SELECT * FROM attachments WHERE job_id = ? ORDER BY created_at DESC, id DESC').all(jobId) as AttachmentRow[];
      return rows.map(toAttachment);
    },
  };
}

export type DocumentsRepo = ReturnType<typeof createDocumentsRepo>;
