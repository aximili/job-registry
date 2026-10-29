-- Follow-up reminders: the day you want to chase a job, and why. A local
-- date (YYYY-MM-DD), like date_applied. Owned by the jobs module.
ALTER TABLE jobs ADD COLUMN follow_up_on TEXT;
ALTER TABLE jobs ADD COLUMN follow_up_note TEXT;
CREATE INDEX jobs_follow_up ON jobs (follow_up_on) WHERE follow_up_on IS NOT NULL;
