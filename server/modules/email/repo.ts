// All SQL for the email_suggestions and email_state tables.

import type { EmailEvent, SuggestionState } from '../../../shared/contracts/index.ts';
import type { Db } from '../../core/db/db.ts';

export type SuggestionRow = {
  id: number;
  messageId: string;
  jobId: number | null;
  fromAddr: string | null;
  subject: string | null;
  receivedAt: string;
  event: EmailEvent | null;
  suggestedStatus: string | null;
  confidence: number | null;
  summary: string | null;
  company: string | null;
  role: string | null;
  state: SuggestionState;
  appliedStatus: string | null;
  createdAt: string;
  handledAt: string | null;
};

export type NewSuggestionRow = Omit<SuggestionRow, 'id' | 'appliedStatus' | 'handledAt'>;

const COLUMNS = `id, message_id AS messageId, job_id AS jobId, from_addr AS fromAddr, subject,
  received_at AS receivedAt, event, suggested_status AS suggestedStatus, confidence, summary,
  company, role, state, applied_status AS appliedStatus, created_at AS createdAt, handled_at AS handledAt`;

export function createEmailRepo(db: Db) {
  const hasStmt = db.prepare('SELECT 1 FROM email_suggestions WHERE message_id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO email_suggestions (message_id, job_id, from_addr, subject, received_at, event, suggested_status,
       confidence, summary, company, role, state, created_at)
     VALUES (@messageId, @jobId, @fromAddr, @subject, @receivedAt, @event, @suggestedStatus,
       @confidence, @summary, @company, @role, @state, @createdAt)`,
  );
  const getStmt = db.prepare(`SELECT ${COLUMNS} FROM email_suggestions WHERE id = ?`);
  const listStmt = db.prepare(`SELECT ${COLUMNS} FROM email_suggestions WHERE state = ? ORDER BY received_at DESC, id DESC`);
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM email_suggestions WHERE state = ?');
  const handleStmt = db.prepare(
    `UPDATE email_suggestions SET state = ?, job_id = ?, applied_status = ?, handled_at = ?
     WHERE id = ? AND state = 'pending'`,
  );
  const getValueStmt = db.prepare('SELECT value FROM email_state WHERE key = ?');
  const deleteValueStmt = db.prepare('DELETE FROM email_state WHERE key = ?');
  const setValueStmt = db.prepare(
    'INSERT INTO email_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );

  return {
    has: (messageId: string): boolean => hasStmt.get(messageId) !== undefined,
    insert: (row: NewSuggestionRow): number => Number(insertStmt.run(row).lastInsertRowid),
    get: (id: number): SuggestionRow | null => (getStmt.get(id) as SuggestionRow | undefined) ?? null,
    listByState: (state: SuggestionState): SuggestionRow[] => listStmt.all(state) as SuggestionRow[],
    countByState: (state: SuggestionState): number => (countStmt.get(state) as { n: number }).n,
    // Only a pending suggestion can be handled, and only once.
    handle(id: number, state: 'confirmed' | 'dismissed', o: { jobId: number | null; appliedStatus: string | null; at: string }): boolean {
      return handleStmt.run(state, o.jobId, o.appliedStatus, o.at, id).changes === 1;
    },
    getValue: (key: string): string | null => (getValueStmt.get(key) as { value: string } | undefined)?.value ?? null,
    setValue: (key: string, value: string): void => {
      setValueStmt.run(key, value);
    },
    deleteValue: (key: string): void => {
      deleteValueStmt.run(key);
    },
  };
}

export type EmailRepo = ReturnType<typeof createEmailRepo>;
