// All SQL for the jobs, postings and status_history tables. Nothing else
// in the app reads or writes these tables.

import { z } from 'zod';
import {
  AdContact,
  FieldSource,
  Job,
  JobSummary,
  Posting,
  StatusChange,
  type EditableJobFields,
  type Rating,
  type ParseState,
  type SourceSite,
  type StatusSource,
} from '../../../shared/contracts/index.ts';
import type { Db } from '../../core/db/db.ts';
import type { MatchableJob } from './match.ts';

// What the service can change on a job. Undefined keys are left alone.
export type JobChanges = Partial<
  EditableJobFields & {
    status: string;
    adContact: z.infer<typeof AdContact> | null;
    fieldSources: Record<string, z.infer<typeof FieldSource>>;
    parseState: ParseState;
    parseError: string | null;
    matchVerdict: string | null;
    matchScore: number | null;
    match: Rating | null;
    archived: boolean;
  }
>;

export type NewPosting = {
  jobId: number;
  canonicalUrl: string | null;
  sourceSite: SourceSite;
  externalId: string | null;
  sourceUrl: string | null;
  jdText: string;
  structuredJson: string | null;
  capturedAt: string;
};

export type ListFilter = {
  statusIds: string[] | null;
  archived: boolean;
  sort: 'updated' | 'applied' | 'company';
};

const PLAIN_COLUMNS: Record<string, string> = {
  title: 'title',
  company: 'company',
  agency: 'agency',
  location: 'location',
  workMode: 'work_mode',
  employmentType: 'employment_type',
  closingDate: 'closing_date',
  status: 'status',
  dateApplied: 'date_applied',
  summary: 'summary',
  parseState: 'parse_state',
  parseError: 'parse_error',
  matchVerdict: 'match_verdict',
  matchScore: 'match_score',
};
const JSON_COLUMNS: Record<string, string> = {
  requirements: 'requirements',
  niceToHave: 'nice_to_have',
  responsibilities: 'responsibilities',
  adContact: 'ad_contact',
  fieldSources: 'field_sources',
  match: 'match_json',
};

function toColumns(changes: JobChanges): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    const plain = PLAIN_COLUMNS[key];
    const json = JSON_COLUMNS[key];
    if (plain) cols[plain] = value;
    else if (json) cols[json] = value === null ? null : JSON.stringify(value);
  }
  if (changes.salary !== undefined) {
    cols.salary_min = changes.salary.min;
    cols.salary_max = changes.salary.max;
    cols.salary_currency = changes.salary.currency;
    cols.salary_period = changes.salary.period;
    cols.salary_text = changes.salary.text;
  }
  if (changes.archived !== undefined) cols.archived = changes.archived ? 1 : 0;
  return cols;
}

type Row = Record<string, unknown>;

const parseJsonColumn = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : null);

function rowToJob(row: Row): Job {
  return Job.parse({
    id: row.id,
    title: row.title,
    company: row.company,
    agency: row.agency,
    location: row.location,
    workMode: row.work_mode,
    employmentType: row.employment_type,
    salary: {
      min: row.salary_min,
      max: row.salary_max,
      currency: row.salary_currency,
      period: row.salary_period,
      text: row.salary_text,
    },
    closingDate: row.closing_date,
    summary: row.summary,
    requirements: parseJsonColumn(row.requirements),
    niceToHave: parseJsonColumn(row.nice_to_have),
    responsibilities: parseJsonColumn(row.responsibilities),
    dateApplied: row.date_applied,
    status: row.status,
    adContact: parseJsonColumn(row.ad_contact),
    fieldSources: parseJsonColumn(row.field_sources),
    parseState: row.parse_state,
    parseError: row.parse_error,
    matchVerdict: row.match_verdict,
    matchScore: row.match_score,
    match: parseJsonColumn(row.match_json),
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const SUMMARY_COLUMNS = 'id, title, company, agency, location, status, date_applied, archived, updated_at';

function rowToSummary(row: Row): JobSummary {
  return JobSummary.parse({
    id: row.id,
    title: row.title,
    company: row.company,
    agency: row.agency,
    location: row.location,
    status: row.status,
    dateApplied: row.date_applied,
    archived: row.archived === 1,
    updatedAt: row.updated_at,
  });
}

function rowToPosting(row: Row): Posting {
  return Posting.parse({
    id: row.id,
    jobId: row.job_id,
    canonicalUrl: row.canonical_url,
    sourceSite: row.source_site,
    externalId: row.external_id,
    sourceUrl: row.source_url,
    jdText: row.jd_text,
    capturedAt: row.captured_at,
  });
}

function rowToStatusChange(row: Row): StatusChange {
  return StatusChange.parse({
    id: row.id,
    jobId: row.job_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    source: row.source,
    changedAt: row.changed_at,
  });
}

const ORDER_BY: Record<ListFilter['sort'], string> = {
  updated: 'updated_at DESC, id DESC',
  applied: 'date_applied DESC NULLS LAST, updated_at DESC, id DESC',
  company: 'company COLLATE NOCASE ASC NULLS LAST, title COLLATE NOCASE ASC, id ASC',
};

export function createJobsRepo(db: Db) {
  const insertPostingStmt = db.prepare(`
    INSERT INTO postings (job_id, canonical_url, source_site, external_id, source_url, jd_text, structured_json, captured_at)
    VALUES (@jobId, @canonicalUrl, @sourceSite, @externalId, @sourceUrl, @jdText, @structuredJson, @capturedAt)`);
  const insertStatusStmt = db.prepare(`
    INSERT INTO status_history (job_id, from_status, to_status, source, changed_at)
    VALUES (@jobId, @fromStatus, @toStatus, @source, @changedAt)`);
  const getJobStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');

  return {
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    insertJob(changes: JobChanges, at: string): number {
      const cols = { ...toColumns(changes), created_at: at, updated_at: at };
      const names = Object.keys(cols);
      const sql = `INSERT INTO jobs (${names.join(', ')}) VALUES (${names.map((n) => `@${n}`).join(', ')})`;
      return Number(db.prepare(sql).run(cols).lastInsertRowid);
    },

    updateJob(id: number, changes: JobChanges, at: string): void {
      const cols = { ...toColumns(changes), updated_at: at };
      const sets = Object.keys(cols).map((n) => `${n} = @${n}`);
      db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = @id`).run({ ...cols, id });
    },

    getJob(id: number): Job | undefined {
      const row = getJobStmt.get(id) as Row | undefined;
      return row ? rowToJob(row) : undefined;
    },

    getSummaries(ids: number[]): JobSummary[] {
      const rows = db
        .prepare(`SELECT ${SUMMARY_COLUMNS} FROM jobs WHERE id IN (SELECT value FROM json_each(?))`)
        .all(JSON.stringify(ids)) as Row[];
      const byId = new Map(rows.map((r) => [r.id as number, rowToSummary(r)]));
      return ids.flatMap((id) => byId.get(id) ?? []);
    },

    listSummaries(filter: ListFilter): JobSummary[] {
      const where = ['archived = @archived'];
      if (filter.statusIds) where.push('status IN (SELECT value FROM json_each(@statusIds))');
      const sql = `SELECT ${SUMMARY_COLUMNS} FROM jobs WHERE ${where.join(' AND ')} ORDER BY ${ORDER_BY[filter.sort]}`;
      const rows = db
        .prepare(sql)
        .all({ archived: filter.archived ? 1 : 0, ...(filter.statusIds ? { statusIds: JSON.stringify(filter.statusIds) } : {}) });
      return (rows as Row[]).map(rowToSummary);
    },

    // Unarchived jobs in one parse state, oldest first.
    listIdsByParseState(state: ParseState): number[] {
      const rows = db.prepare('SELECT id FROM jobs WHERE parse_state = ? AND archived = 0 ORDER BY created_at, id').all(state);
      return (rows as { id: number }[]).map((r) => r.id);
    },

    listIds(archived: boolean): number[] {
      return (db.prepare('SELECT id FROM jobs WHERE archived = ? ORDER BY id').all(archived ? 1 : 0) as { id: number }[]).map(
        (r) => r.id,
      );
    },

    insertPosting(posting: NewPosting): number {
      return Number(insertPostingStmt.run(posting).lastInsertRowid);
    },

    findPostingByUrl(canonicalUrl: string): Posting | undefined {
      const row = db.prepare('SELECT * FROM postings WHERE canonical_url = ?').get(canonicalUrl) as Row | undefined;
      return row ? rowToPosting(row) : undefined;
    },

    findPostingBySiteId(sourceSite: SourceSite, externalId: string): Posting | undefined {
      const row = db
        .prepare('SELECT * FROM postings WHERE source_site = ? AND external_id = ?')
        .get(sourceSite, externalId) as Row | undefined;
      return row ? rowToPosting(row) : undefined;
    },

    // Open, unarchived jobs created since `since`, with the sites their ads came from.
    listMatchable(since: string, openStatusIds: string[]): MatchableJob[] {
      const rows = db
        .prepare(
          `SELECT j.id, j.title, j.company, j.agency, j.location, j.status, j.date_applied, j.created_at,
             (SELECT json_group_array(DISTINCT p.source_site) FROM postings p WHERE p.job_id = j.id) AS sites
           FROM jobs j
           WHERE j.archived = 0 AND j.created_at >= ? AND j.status IN (SELECT value FROM json_each(?))`,
        )
        .all(since, JSON.stringify(openStatusIds)) as Row[];
      return rows.map((r) => ({
        id: r.id as number,
        title: r.title as string | null,
        company: r.company as string | null,
        agency: r.agency as string | null,
        location: r.location as string | null,
        status: r.status as string,
        dateApplied: r.date_applied as string | null,
        createdAt: r.created_at as string,
        sourceSites: JSON.parse(r.sites as string) as SourceSite[],
      }));
    },

    listPostings(jobId: number): Posting[] {
      const rows = db.prepare('SELECT * FROM postings WHERE job_id = ? ORDER BY captured_at DESC, id DESC').all(jobId);
      return (rows as Row[]).map(rowToPosting);
    },

    insertStatusChange(change: { jobId: number; fromStatus: string | null; toStatus: string; source: StatusSource; changedAt: string }): void {
      insertStatusStmt.run(change);
    },

    listHistory(jobId: number): StatusChange[] {
      const rows = db.prepare('SELECT * FROM status_history WHERE job_id = ? ORDER BY changed_at DESC, id DESC').all(jobId);
      return (rows as Row[]).map(rowToStatusChange);
    },
  };
}

export type JobsRepo = ReturnType<typeof createJobsRepo>;
