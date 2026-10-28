// The jobs module's logic: saving jobs and their ads, editing, status changes
// and lists. It never waits for the AI. Plain inputs, plain outputs: no HTTP, no SQL.

import type {
  Capture,
  EditableJobFields,
  FieldSource,
  Job,
  JobCheckRequest,
  JobCheckResponse,
  JobSummary,
  ExactMatch,
  ListJobsQuery,
  Posting,
  PostingLookupResponse,
  SaveJobRequest,
  SaveJobResponse,
  Status,
  StatusChange,
  StatusSource,
  UpdateJobRequest,
} from '../../../shared/contracts/index.ts';
import { canonicalJobUrl } from '../../../shared/canonical-url.ts';
import { localDate } from '../../../shared/dates.ts';
import type { Clock } from '../../core/config.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.ts';
import type { EventBus } from '../../core/events.ts';
import { findCandidates } from './match.ts';
import type { JobChanges, JobsRepo } from './repo.ts';

export interface JobsService {
  save(req: SaveJobRequest): SaveJobResponse;
  check(req: JobCheckRequest): JobCheckResponse;
  get(id: number): Job;
  getSummaries(ids: number[]): JobSummary[];
  list(q: ListJobsQuery): JobSummary[];
  listIds(opts: { archived: boolean }): number[];
  update(id: number, patch: UpdateJobRequest): Job;
  changeStatus(id: number, status: string, source: StatusSource): Job;
  addPosting(jobId: number, capture: Capture): Job;
  lookupByUrl(url: string): PostingLookupResponse;
  listPostings(jobId: number): Posting[];
  listHistory(jobId: number): StatusChange[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MATCH_WINDOW_DAYS = 183;

export type JobsOptions = {
  repo: JobsRepo;
  bus: EventBus;
  statuses: () => Status[];
  now: Clock;
};

const NULLABLE_TEXT = ['title', 'company', 'agency', 'location', 'summary'] as const;

function emptyFields(): EditableJobFields {
  return {
    title: null,
    company: null,
    agency: null,
    location: null,
    workMode: 'unknown',
    employmentType: 'unknown',
    salary: { min: null, max: null, currency: null, period: null, text: null },
    closingDate: null,
    summary: null,
    requirements: [],
    niceToHave: [],
    responsibilities: [],
    dateApplied: null,
  };
}

// Trims text fields and turns blanks into "no value".
function tidy(fields: Partial<EditableJobFields>): Partial<EditableJobFields> {
  const out: Record<string, unknown> = { ...fields };
  for (const key of NULLABLE_TEXT) {
    const value = out[key];
    if (typeof value === 'string') out[key] = value.trim() === '' ? null : value.trim();
  }
  return out as Partial<EditableJobFields>;
}

function definedKeys(obj: object): string[] {
  return Object.entries(obj)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}

export function createJobsService(opts: JobsOptions): JobsService {
  const { repo, bus } = opts;

  function statusOrThrow(id: string): Status {
    const status = opts.statuses().find((s) => s.id === id);
    if (!status) throw new ValidationError(`Unknown status '${id}'.`);
    return status;
  }

  function get(id: number): Job {
    const job = repo.getJob(id);
    if (!job) throw new NotFoundError(`Job ${id} not found`);
    return job;
  }

  // The same ad: same canonical link, or the same job id on the same site.
  function findExact(ad: Pick<Capture, 'canonicalUrl' | 'sourceSite' | 'externalId'>): Posting | undefined {
    if (ad.canonicalUrl) {
      const byUrl = repo.findPostingByUrl(ad.canonicalUrl);
      if (byUrl) return byUrl;
    }
    return ad.externalId ? repo.findPostingBySiteId(ad.sourceSite, ad.externalId) : undefined;
  }

  function toExact(job: Job): ExactMatch {
    return { jobId: job.id, title: job.title, company: job.company, status: job.status, dateApplied: job.dateApplied };
  }

  function check(req: JobCheckRequest): JobCheckResponse {
    const posting = findExact(req);
    if (posting) return { exact: toExact(get(posting.jobId)), candidates: [] };
    const since = new Date(opts.now().getTime() - MATCH_WINDOW_DAYS * DAY_MS).toISOString();
    const open = opts.statuses().filter((s) => !s.closed).map((s) => s.id);
    const input = {
      ...(req.title ? { title: req.title } : {}),
      ...(req.company ? { company: req.company } : {}),
      ...(req.location ? { location: req.location } : {}),
    };
    return { exact: null, candidates: findCandidates(input, repo.listMatchable(since, open)) };
  }

  // What to match on when saving: what you typed, else what the ad says.
  function checkRequestFor(req: SaveJobRequest): JobCheckRequest {
    const { capture } = req;
    const pick = (key: 'title' | 'company' | 'location') =>
      req.fields?.[key] ?? capture.structured?.[key] ?? capture[key] ?? undefined;
    const title = pick('title');
    const company = pick('company');
    const location = pick('location');
    return {
      canonicalUrl: capture.canonicalUrl,
      sourceSite: capture.sourceSite,
      externalId: capture.externalId,
      ...(title ? { title } : {}),
      ...(company ? { company } : {}),
      ...(location ? { location } : {}),
    };
  }

  function changeStatus(id: number, statusId: string, source: StatusSource): Job {
    const job = get(id);
    const status = statusOrThrow(statusId);
    if (job.status === statusId) return job;
    const at = opts.now();
    const iso = at.toISOString();
    repo.transaction(() => {
      repo.insertStatusChange({ jobId: id, fromStatus: job.status, toStatus: statusId, source, changedAt: iso });
      repo.updateJob(
        id,
        { status: statusId, ...(status.setsAppliedDate && !job.dateApplied ? { dateApplied: localDate(at) } : {}) },
        iso,
      );
    });
    bus.emit('job.statusChanged', { jobId: id, from: job.status, to: statusId, source });
    return get(id);
  }

  function addPosting(jobId: number, capture: Capture): Job {
    const job = get(jobId);
    const existing = findExact(capture);
    if (existing) {
      if (existing.jobId === jobId) return job;
      throw new ConflictError(`This ad is already saved on job ${existing.jobId}.`);
    }
    const iso = opts.now().toISOString();
    const postingId = repo.transaction(() => {
      const id = repo.insertPosting({
        jobId,
        canonicalUrl: capture.canonicalUrl,
        sourceSite: capture.sourceSite,
        externalId: capture.externalId,
        sourceUrl: capture.sourceUrl,
        jdText: capture.jdText,
        structuredJson: capture.structured ? JSON.stringify(capture.structured) : null,
        capturedAt: capture.capturedAt,
      });
      repo.updateJob(jobId, {}, iso);
      return id;
    });
    bus.emit('posting.added', { jobId, postingId });
    return get(jobId);
  }

  function create(req: SaveJobRequest): Job {
    const { capture } = req;
    const statusId = req.status ?? 'saved';
    const status = statusOrThrow(statusId);
    const at = opts.now();
    const iso = at.toISOString();

    // Fields from the ad first, then anything you typed, which wins.
    const fields = emptyFields();
    const sources: Record<string, FieldSource> = {};
    const fromAd = tidy({
      ...(capture.title ? { title: capture.title } : {}),
      ...(capture.company ? { company: capture.company } : {}),
      ...(capture.location ? { location: capture.location } : {}),
      ...stripAdContact(capture.structured),
    });
    for (const key of definedKeys(fromAd)) sources[key] = 'ad';
    const fromUser = tidy(req.fields ?? {});
    for (const key of definedKeys(fromUser)) sources[key] = 'user';
    Object.assign(fields, definedOnly(fromAd), definedOnly(fromUser));
    if (status.setsAppliedDate && !fields.dateApplied) fields.dateApplied = localDate(at);

    const { jobId, postingId } = repo.transaction(() => {
      const jobId = repo.insertJob(
        {
          ...fields,
          status: statusId,
          adContact: capture.structured?.adContact ?? null,
          fieldSources: sources,
          parseState: capture.jdText.trim() ? 'pending' : 'none',
        },
        iso,
      );
      const postingId = repo.insertPosting({
        jobId,
        canonicalUrl: capture.canonicalUrl,
        sourceSite: capture.sourceSite,
        externalId: capture.externalId,
        sourceUrl: capture.sourceUrl,
        jdText: capture.jdText,
        structuredJson: capture.structured ? JSON.stringify(capture.structured) : null,
        capturedAt: capture.capturedAt,
      });
      repo.insertStatusChange({ jobId, fromStatus: null, toStatus: statusId, source: req.source ?? 'manual', changedAt: iso });
      return { jobId, postingId };
    });

    bus.emit('job.saved', { jobId });
    bus.emit('posting.added', { jobId, postingId });
    return get(jobId);
  }

  return {
    save(req) {
      const exact = findExact(req.capture);
      if (exact) return { result: 'exists', job: get(exact.jobId) };
      if (typeof req.decision === 'object') {
        // "Same job": add this ad to it. If you also chose a status that's further
        // along (say, Applied for a job that was only Saved), move the job forward.
        // Never move it back.
        const target = req.status ? statusOrThrow(req.status) : null;
        let job = addPosting(req.decision.linkTo, req.capture);
        const now = opts.statuses().find((s) => s.id === job.status);
        if (target && (!now || target.order > now.order)) job = changeStatus(job.id, target.id, req.source ?? 'manual');
        return { result: 'linked', job };
      }
      if (req.decision === undefined) {
        const { candidates } = check(checkRequestFor(req));
        if (candidates.length > 0) return { result: 'needs_decision', candidates };
      }
      return { result: 'created', job: create(req) };
    },

    addPosting,

    lookupByUrl(url) {
      let canonical: ReturnType<typeof canonicalJobUrl>;
      try {
        canonical = canonicalJobUrl(url);
      } catch {
        throw new ValidationError("That doesn't look like a web link.");
      }
      const posting = findExact(canonical);
      return { match: posting ? toExact(get(posting.jobId)) : null };
    },

    check,
    get,

    getSummaries: (ids) => repo.getSummaries(ids),

    list(q) {
      const all = opts.statuses();
      let statusIds: string[] | null;
      if (q.status === 'all') statusIds = null;
      else if (q.status === 'open') statusIds = all.filter((s) => !s.closed).map((s) => s.id);
      else if (q.status === 'closed') statusIds = all.filter((s) => s.closed).map((s) => s.id);
      else statusIds = q.status.split(',').map((s) => s.trim()).filter(Boolean);
      return repo.listSummaries({ statusIds, archived: q.archived, sort: q.sort });
    },

    listIds: ({ archived }) => repo.listIds(archived),

    update(id, patch) {
      const job = get(id);
      const { archived, ...rest } = patch;
      const fields = tidy(rest);
      // Only values that really differ count as your edits. An edit form sends
      // every field back, and marking them all as "yours" would stop the AI
      // from ever filling them in.
      const current = job as unknown as Record<string, unknown>;
      const changed = definedKeys(fields).filter(
        (key) => stableJson((fields as Record<string, unknown>)[key]) !== stableJson(current[key]),
      );
      const archivedChanged = archived !== undefined && archived !== job.archived;
      if (changed.length === 0 && !archivedChanged) return job;

      const fieldSources = { ...job.fieldSources };
      for (const key of changed) fieldSources[key] = 'user';
      const values = Object.fromEntries(changed.map((key) => [key, (fields as Record<string, unknown>)[key]]));
      const changes: JobChanges = { ...values, fieldSources, ...(archivedChanged ? { archived } : {}) };
      repo.updateJob(id, changes, opts.now().toISOString());
      bus.emit('job.updated', { jobId: id, fields: [...changed, ...(archivedChanged ? ['archived'] : [])] });
      return get(id);
    },

    changeStatus,

    listPostings: (jobId) => repo.listPostings(jobId),
    listHistory: (jobId) => repo.listHistory(jobId),
  };
}

function stripAdContact(structured: Capture['structured']): Partial<EditableJobFields> {
  if (!structured) return {};
  const { adContact: _contact, ...fields } = structured;
  return fields;
}

// JSON with object keys sorted, so two equal values always compare equal.
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>;
}
