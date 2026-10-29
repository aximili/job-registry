-- Emails that looked like they were about a job, as suggestions you confirm
-- or dismiss. Only summaries are kept, never the email itself. An "ignored"
-- row keeps just the message id and date, so it isn't read twice.
-- Owned by the email module.
CREATE TABLE email_suggestions (
  id INTEGER PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  job_id INTEGER REFERENCES jobs(id),
  from_addr TEXT,
  subject TEXT,
  received_at TEXT NOT NULL,
  event TEXT,
  suggested_status TEXT,
  confidence REAL,
  summary TEXT,
  company TEXT,
  role TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'confirmed', 'dismissed', 'ignored')),
  applied_status TEXT,
  created_at TEXT NOT NULL,
  handled_at TEXT
);
CREATE INDEX email_suggestions_by_state ON email_suggestions (state, received_at);

-- Small facts about checking: the mailbox cursor and the last check's result.
CREATE TABLE email_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
