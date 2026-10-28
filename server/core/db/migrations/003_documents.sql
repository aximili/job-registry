-- Resumes and cover letters, one row per saved version, plus files you
-- attach to a job. Owned by the documents module.
-- Versions are only ever added. Marking one as sent stores the template CSS
-- as it was then, once; after that the row never changes.
CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  kind TEXT NOT NULL CHECK (kind IN ('resume', 'cover_letter')),
  version INTEGER NOT NULL,
  markdown TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('generated', 'edited', 'copied')),
  copied_from_id INTEGER REFERENCES documents(id),
  is_sent INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  sent_css TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (job_id, kind, version)
);

CREATE TRIGGER documents_versions_never_change
BEFORE UPDATE OF job_id, kind, version, markdown, origin, copied_from_id, created_at ON documents
BEGIN
  SELECT RAISE(ABORT, 'A saved document version is never changed. Save a new version instead.');
END;

CREATE TRIGGER documents_sent_never_change
BEFORE UPDATE OF is_sent, sent_at, sent_css ON documents
WHEN OLD.is_sent = 1
BEGIN
  SELECT RAISE(ABORT, 'A sent document is never changed.');
END;

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  kind TEXT NOT NULL CHECK (kind IN ('resume', 'cover_letter', 'other')),
  file_name TEXT NOT NULL,
  -- Relative to data/files/, so a moved data folder still works.
  stored_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX attachments_job ON attachments(job_id);
