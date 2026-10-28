-- Phase 1 schema. Never edit this file once it has run on a real database:
-- add 002_*.sql instead. Table ownership is in docs/architecture.md §4.1.

-- jobs module ---------------------------------------------------------------

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  title TEXT,
  company TEXT,
  agency TEXT,
  location TEXT,
  work_mode TEXT NOT NULL DEFAULT 'unknown',
  employment_type TEXT NOT NULL DEFAULT 'unknown',
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT,
  salary_period TEXT,
  salary_text TEXT,
  closing_date TEXT,
  status TEXT NOT NULL,
  date_applied TEXT,
  summary TEXT,
  requirements TEXT NOT NULL DEFAULT '[]',
  nice_to_have TEXT NOT NULL DEFAULT '[]',
  responsibilities TEXT NOT NULL DEFAULT '[]',
  ad_contact TEXT,
  field_sources TEXT NOT NULL DEFAULT '{}',
  parse_state TEXT NOT NULL DEFAULT 'none',
  parse_error TEXT,
  match_verdict TEXT,
  match_score INTEGER,
  match_json TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX jobs_status ON jobs(status, archived);
CREATE INDEX jobs_updated ON jobs(updated_at);

CREATE TABLE postings (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  canonical_url TEXT UNIQUE,
  source_site TEXT NOT NULL,
  external_id TEXT,
  source_url TEXT,
  jd_text TEXT NOT NULL DEFAULT '',
  structured_json TEXT,
  captured_at TEXT NOT NULL
);
CREATE INDEX postings_job ON postings(job_id);
CREATE UNIQUE INDEX postings_site_id ON postings(source_site, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE status_history (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  source TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX status_history_job ON status_history(job_id, changed_at);

-- notes module --------------------------------------------------------------

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX notes_job ON notes(job_id, created_at);

-- contacts module -----------------------------------------------------------

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  organisation TEXT,
  email TEXT,
  phone TEXT,
  phone_digits TEXT NOT NULL DEFAULT '',
  linkedin_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE job_contacts (
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  relation TEXT NOT NULL DEFAULT 'recruiter',
  PRIMARY KEY (job_id, contact_id)
);
CREATE INDEX job_contacts_contact ON job_contacts(contact_id);

CREATE TABLE interactions (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id),
  job_id INTEGER REFERENCES jobs(id),
  kind TEXT NOT NULL,
  happened_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX interactions_job ON interactions(job_id, happened_at);
CREATE INDEX interactions_contact ON interactions(contact_id, happened_at);

-- search module -------------------------------------------------------------

CREATE VIRTUAL TABLE search_index USING fts5(
  kind UNINDEXED,
  ref_id UNINDEXED,
  title,
  people,
  notes,
  ad,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);
