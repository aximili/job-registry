-- Getting ready to write and to interview. Owned by the prep module.
-- briefs: the brief you check before the AI writes, as you've edited it
-- (JSON, checked by zod on every read and write). A new brief is a new row:
-- the newest is the job's brief, and older ones stay. made_by is the name of
-- the AI that made it, and approved_at is when a document was last written
-- with it.
CREATE TABLE briefs (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  brief_json TEXT NOT NULL,
  made_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX briefs_job ON briefs (job_id, id);

-- prep_plans: each "Get ready" plan for an interview (JSON, checked the
-- same way). A new plan is a new row, and older ones stay.
CREATE TABLE prep_plans (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  plan_json TEXT NOT NULL,
  made_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX prep_plans_job ON prep_plans (job_id, id);
