import { pino } from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_STATUSES } from '../../../shared/contracts/index.ts';
import { pastedCapture, seekCapture } from '../../../tests/helpers/jobs.ts';
import { openDb } from '../../core/db/db.ts';
import { NotFoundError, ValidationError } from '../../core/errors.ts';
import { createEventBus, type EventBus } from '../../core/events.ts';
import { createJobsModule, type JobsService } from './index.ts';

let clock: Date;
let bus: EventBus;
let jobs: JobsService;
let events: [string, unknown][];

beforeEach(() => {
  clock = new Date('2026-10-28T03:15:00.000Z');
  bus = createEventBus(pino({ level: 'silent' }));
  events = [];
  bus.onAny((name, payload) => events.push([name, payload]));
  jobs = createJobsModule({ db: openDb(':memory:'), bus, statuses: () => [...DEFAULT_STATUSES], now: () => clock }).service;
});

function create(req: Parameters<JobsService['save']>[0]) {
  const res = jobs.save(req);
  if (res.result !== 'created') throw new Error(`expected created, got ${res.result}`);
  return res.job;
}

describe('jobs service: save', () => {
  it('save creates the job, its first posting and the first status change together', () => {
    const job = create({ capture: seekCapture('81234567'), fields: { title: 'Senior Engineer', company: 'Atlassian' } });
    expect(job).toMatchObject({ title: 'Senior Engineer', company: 'Atlassian', status: 'saved', archived: false });
    expect(jobs.listPostings(job.id)).toEqual([
      expect.objectContaining({ jobId: job.id, canonicalUrl: 'https://www.seek.com.au/job/81234567', sourceSite: 'seek' }),
    ]);
    expect(jobs.listHistory(job.id)).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: 'saved', source: 'manual', changedAt: clock.toISOString() }),
    ]);
  });

  it('save takes fields from capture.structured and marks them as from the ad', () => {
    const job = create({
      capture: pastedCapture('ad', {
        structured: {
          title: 'Platform Engineer',
          company: 'Canva',
          location: 'Sydney NSW',
          salary: { min: 150000, max: 170000, currency: 'AUD', period: 'year', text: null },
        },
      }),
    });
    expect(job).toMatchObject({ title: 'Platform Engineer', company: 'Canva', location: 'Sydney NSW' });
    expect(job.salary.min).toBe(150000);
    expect(job.fieldSources).toMatchObject({ title: 'ad', company: 'ad', location: 'ad', salary: 'ad' });
  });

  it('user-entered fields win over ad fields and are marked user', () => {
    const job = create({
      capture: pastedCapture('ad', { title: 'Engineer', structured: { company: 'Canva Pty Ltd' } }),
      fields: { company: 'Canva', agency: 'Hays' },
    });
    expect(job).toMatchObject({ title: 'Engineer', company: 'Canva', agency: 'Hays' });
    expect(job.fieldSources).toMatchObject({ title: 'ad', company: 'user', agency: 'user' });
  });

  it('save with status applied sets dateApplied to the local date', () => {
    clock = new Date('2026-10-28T22:30:00.000Z'); // 9:30 am on the 29th in Sydney
    const job = create({ capture: pastedCapture(), status: 'applied' });
    expect(job.dateApplied).toBe('2026-10-29');
  });

  it('save rejects an unknown status', () => {
    expect(() => jobs.save({ capture: pastedCapture(), status: 'interviewing' })).toThrow(
      new ValidationError("Unknown status 'interviewing'."),
    );
  });

  it('save accepts a job with no title or company', () => {
    const job = create({ capture: pastedCapture('') });
    expect(job.title).toBeNull();
    expect(job.company).toBeNull();
  });

  it('save keeps a 60,000-character ad in full', () => {
    const ad = `${'Responsibilities include… '.repeat(2400)}`.slice(0, 60_000);
    const job = create({ capture: pastedCapture(ad) });
    expect(jobs.listPostings(job.id)[0]?.jdText).toHaveLength(60_000);
  });

  it('save sets parseState pending when there is ad text, otherwise none', () => {
    expect(create({ capture: pastedCapture('Some ad text') }).parseState).toBe('pending');
    expect(create({ capture: pastedCapture('   ') }).parseState).toBe('none');
  });

  it('emits job.saved then posting.added after the transaction commits', () => {
    let seenInListener: unknown;
    bus.on('job.saved', ({ jobId }) => {
      seenInListener = jobs.get(jobId).title;
    });
    const job = create({ capture: pastedCapture(), fields: { title: 'Analyst' } });
    expect(events.map(([name]) => name)).toEqual(['job.saved', 'posting.added']);
    expect(events[1]?.[1]).toEqual({ jobId: job.id, postingId: jobs.listPostings(job.id)[0]?.id });
    expect(seenInListener).toBe('Analyst');
  });
});

describe('jobs service: status, update, list, get', () => {
  it('changeStatus logs history, and does nothing for the same status', () => {
    const job = create({ capture: pastedCapture() });
    clock = new Date('2026-10-29T01:00:00.000Z');
    const moved = jobs.changeStatus(job.id, 'interview_1', 'manual');
    expect(moved.status).toBe('interview_1');
    expect(jobs.listHistory(job.id).map((h) => [h.fromStatus, h.toStatus])).toEqual([
      ['saved', 'interview_1'],
      [null, 'saved'],
    ]);
    events = [];
    jobs.changeStatus(job.id, 'interview_1', 'manual');
    expect(jobs.listHistory(job.id)).toHaveLength(2);
    expect(events).toEqual([]);
  });

  it('changeStatus to a setsAppliedDate status fills dateApplied only when empty', () => {
    const job = create({ capture: pastedCapture() });
    expect(jobs.changeStatus(job.id, 'applied', 'manual').dateApplied).toBe('2026-10-28');
    jobs.update(job.id, { dateApplied: '2026-10-20' });
    jobs.changeStatus(job.id, 'screening', 'manual');
    expect(jobs.changeStatus(job.id, 'applied', 'manual').dateApplied).toBe('2026-10-20');
  });

  it('update marks changed fields as user and emits job.updated with their names', () => {
    const job = create({ capture: pastedCapture('ad', { structured: { company: 'Canva', title: 'Designer' } }) });
    events = [];
    const updated = jobs.update(job.id, { company: 'Canva Australia', location: 'Sydney', title: '' });
    expect(updated).toMatchObject({ company: 'Canva Australia', location: 'Sydney', title: null });
    expect(updated.fieldSources).toMatchObject({ company: 'user', location: 'user', title: 'user' });
    expect(events).toEqual([['job.updated', { jobId: job.id, fields: ['company', 'location', 'title'] }]]);
  });

  it('list filters open, closed, all and id lists, hides archived, and sorts', () => {
    const a = create({ capture: pastedCapture(), fields: { company: 'zeta' }, status: 'applied' });
    const b = create({ capture: pastedCapture(), fields: { company: 'Alpha' }, status: 'rejected' });
    const c = create({ capture: pastedCapture(), fields: { company: null }, status: 'saved' });
    const d = create({ capture: pastedCapture(), fields: { company: 'Beta' }, status: 'offer' });
    jobs.update(d.id, { archived: true });

    const ids = (q: Parameters<JobsService['list']>[0]) => jobs.list(q).map((j) => j.id);
    expect(ids({ status: 'open', archived: false, sort: 'company' })).toEqual([a.id, c.id]);
    expect(ids({ status: 'closed', archived: false, sort: 'company' })).toEqual([b.id]);
    expect(ids({ status: 'all', archived: false, sort: 'company' })).toEqual([b.id, a.id, c.id]);
    expect(ids({ status: 'saved,rejected', archived: false, sort: 'company' })).toEqual([b.id, c.id]);
    expect(ids({ status: 'all', archived: true, sort: 'company' })).toEqual([d.id]);
  });

  it('get throws NotFoundError for an unknown id', () => {
    expect(() => jobs.get(999)).toThrow(new NotFoundError('Job 999 not found'));
  });
});

describe('jobs service: duplicates', () => {
  const atlassian = { title: 'Senior Engineer', company: 'Atlassian', location: 'Sydney NSW' };

  it('check finds an exact match by canonical URL or by site id', () => {
    const job = create({ capture: seekCapture('81234567'), fields: atlassian });
    const byUrl = jobs.check({ canonicalUrl: 'https://www.seek.com.au/job/81234567', sourceSite: 'seek', externalId: null });
    expect(byUrl.exact?.jobId).toBe(job.id);
    const bySiteId = jobs.check({ canonicalUrl: null, sourceSite: 'seek', externalId: '81234567' });
    expect(bySiteId.exact?.jobId).toBe(job.id);
  });

  it('check ignores closed jobs and jobs created more than 183 days ago', () => {
    clock = new Date('2026-04-01T00:00:00.000Z');
    create({ capture: pastedCapture(), fields: atlassian });
    clock = new Date('2026-10-28T03:15:00.000Z');
    create({ capture: pastedCapture(), fields: atlassian, status: 'rejected' });
    const res = jobs.check({ canonicalUrl: null, sourceSite: 'pasted', externalId: null, ...atlassian });
    expect(res).toEqual({ exact: null, candidates: [] });
  });

  it('save with no decision returns needs_decision; with linkTo returns linked with 2 postings; with new returns created', () => {
    const first = create({ capture: seekCapture('1'), fields: atlassian, status: 'applied' });
    const linkedInCapture = {
      ...seekCapture('2'),
      sourceSite: 'linkedin' as const,
      canonicalUrl: 'https://www.linkedin.com/jobs/view/4012345678/',
      externalId: '4012345678',
    };
    const req = { capture: linkedInCapture, fields: { title: 'Senior Engineer', company: 'Atlassian Pty Ltd' } };

    const asked = jobs.save(req);
    expect(asked.result).toBe('needs_decision');
    if (asked.result !== 'needs_decision') return;
    expect(asked.candidates[0]).toMatchObject({ jobId: first.id, strength: 'likely', status: 'applied', sourceSites: ['seek'] });

    const linked = jobs.save({ ...req, decision: { linkTo: first.id } });
    expect(linked.result).toBe('linked');
    expect(jobs.listPostings(first.id)).toHaveLength(2);
    expect(jobs.list({ status: 'all', archived: false, sort: 'updated' })).toHaveLength(1);

    const other = jobs.save({ capture: seekCapture('3'), fields: req.fields, decision: 'new' });
    expect(other.result).toBe('created');
  });

  it('saving the same link twice returns exists', () => {
    const first = create({ capture: seekCapture('81234567'), fields: atlassian });
    const again = jobs.save({ capture: seekCapture('81234567') });
    expect(again).toMatchObject({ result: 'exists', job: { id: first.id } });
  });

  it('addPosting refuses an ad already saved on another job', () => {
    const a = create({ capture: seekCapture('1'), fields: { title: 'A' } });
    const b = create({ capture: seekCapture('2'), fields: { title: 'B' } });
    expect(() => jobs.addPosting(b.id, seekCapture('1'))).toThrow(`This ad is already saved on job ${a.id}.`);
    expect(jobs.addPosting(a.id, seekCapture('1')).id).toBe(a.id);
    expect(jobs.listPostings(a.id)).toHaveLength(1);
  });

  it('lookupByUrl canonicalises first', () => {
    const job = create({ capture: seekCapture('81234567'), fields: atlassian });
    const res = jobs.lookupByUrl('https://www.seek.com.au/software-engineer-jobs/in-All-Sydney-NSW?jobId=81234567&type=standard');
    expect(res.match).toMatchObject({ jobId: job.id, title: 'Senior Engineer', status: 'saved' });
    expect(jobs.lookupByUrl('https://www.seek.com.au/job/1').match).toBeNull();
  });
});

describe('jobs service: review fixes', () => {
  it('update with unchanged values changes nothing', () => {
    const job = create({ capture: pastedCapture('ad', { structured: { company: 'Canva' } }), fields: { title: 'Designer' } });
    clock = new Date('2026-10-30T00:00:00.000Z');
    events = [];
    const { id, status, adContact, fieldSources, parseState, parseError, matchVerdict, matchScore, archived, createdAt, updatedAt, ...fields } = job;
    const same = jobs.update(job.id, fields);
    expect(same.updatedAt).toBe(job.updatedAt);
    expect(same.fieldSources).toEqual(job.fieldSources);
    expect(events).toEqual([]);

    const changed = jobs.update(job.id, { ...fields, location: 'Sydney' });
    expect(changed.fieldSources).toEqual({ ...job.fieldSources, location: 'user' });
    expect(events).toEqual([['job.updated', { jobId: job.id, fields: ['location'] }]]);
  });

  it('linking an ad moves the job forward to a later chosen status, never back', () => {
    const atlassian = { title: 'Senior Engineer', company: 'Atlassian' };
    const saved = create({ capture: seekCapture('1'), fields: atlassian });
    const linked = jobs.save({ capture: seekCapture('2'), status: 'applied', decision: { linkTo: saved.id } });
    expect(linked).toMatchObject({ result: 'linked', job: { status: 'applied', dateApplied: '2026-10-28' } });

    const further = create({ capture: seekCapture('3'), fields: { title: 'Other' }, status: 'interview_1' });
    const kept = jobs.save({ capture: seekCapture('4'), status: 'applied', decision: { linkTo: further.id } });
    expect(kept).toMatchObject({ result: 'linked', job: { status: 'interview_1' } });
  });
});
