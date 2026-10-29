import { pino } from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_STATUSES, type ParsedJob, type Rating } from '../../../shared/contracts/index.ts';
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

  it('checkMany answers each link or site id in order, with the same match check() gives', () => {
    const a = create({ capture: seekCapture('1'), fields: atlassian });
    const b = create({ capture: seekCapture('2'), fields: { title: 'Designer', company: 'Canva' } });
    jobs.update(b.id, { archived: true });
    const items = [
      { canonicalUrl: 'https://www.seek.com.au/job/1', sourceSite: 'seek' as const, externalId: null },
      { canonicalUrl: 'https://www.seek.com.au/job/999', sourceSite: 'seek' as const, externalId: null },
      { canonicalUrl: 'https://www.seek.com.au/job/2?type=promoted', sourceSite: 'seek' as const, externalId: '2' },
    ];
    const results = jobs.checkMany(items);
    expect(results).toEqual([
      { jobId: a.id, title: 'Senior Engineer', company: 'Atlassian', status: 'saved', dateApplied: null },
      null,
      { jobId: b.id, title: 'Designer', company: 'Canva', status: 'saved', dateApplied: null },
    ]);
    expect(results).toEqual(items.map((item) => jobs.check(item).exact));
  });
});

describe('jobs service: review fixes', () => {
  it('update with unchanged values changes nothing', () => {
    const job = create({ capture: pastedCapture('ad', { structured: { company: 'Canva' } }), fields: { title: 'Designer' } });
    clock = new Date('2026-10-30T00:00:00.000Z');
    events = [];
    const { id, status, adContact, fieldSources, parseState, parseError, matchVerdict, matchScore, match, archived, createdAt, updatedAt, ...fields } = job;
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

describe('jobs: Phase 1 close-out', () => {
  it('saving an ad that is already saved moves its job forward to a later chosen status, never back', () => {
    const saved = create({ capture: seekCapture('1'), fields: { title: 'Senior Engineer', company: 'Atlassian' } });
    const again = jobs.save({ capture: seekCapture('1'), status: 'applied' });
    expect(again).toMatchObject({ result: 'exists', job: { id: saved.id, status: 'applied', dateApplied: '2026-10-28' } });
    expect(jobs.listHistory(saved.id).map((h) => h.toStatus)).toEqual(['applied', 'saved']); // newest first

    const back = jobs.save({ capture: seekCapture('1'), status: 'saved' });
    expect(back).toMatchObject({ result: 'exists', job: { status: 'applied' } });
    expect(jobs.listHistory(saved.id)).toHaveLength(2);
  });
});

describe('jobs: day boundary', () => {
  it('the applied date is the local day in Sydney, not the UTC day', () => {
    const late = create({ capture: seekCapture('1'), fields: { title: 'A' } });
    const early = create({ capture: seekCapture('2'), fields: { title: 'B' } });
    clock = new Date('2026-10-28T12:59:00.000Z'); // 11:59 pm on 28 Oct in Sydney
    expect(jobs.changeStatus(late.id, 'applied', 'manual').dateApplied).toBe('2026-10-28');
    clock = new Date('2026-10-28T13:01:00.000Z'); // 12:01 am on 29 Oct in Sydney, still the 28th in UTC
    expect(jobs.changeStatus(early.id, 'applied', 'manual').dateApplied).toBe('2026-10-29');
  });
});

describe('jobs: what the AI read', () => {
  const parsed = (over: Partial<ParsedJob> = {}): ParsedJob => ({
    title: 'Senior Engineer',
    company: 'Atlassian',
    agency: null,
    location: 'Sydney NSW',
    workMode: 'hybrid',
    employmentType: 'full-time',
    salary: { min: 150000, max: 170000, currency: 'AUD', period: 'year', text: '$150k - $170k' },
    closingDate: '2026-11-30',
    summary: 'Build developer tools.',
    requirements: ['TypeScript'],
    niceToHave: ['Go'],
    responsibilities: ['Ship features'],
    adContact: { name: 'Priya Shah', email: null, phone: '0412 345 678' },
    ...over,
  });

  it('applyParsed fills empty fields and marks them as from the AI', () => {
    const job = create({ capture: pastedCapture('An ad.') });
    events = [];
    const after = jobs.applyParsed(job.id, parsed());
    expect(after).toMatchObject({ title: 'Senior Engineer', company: 'Atlassian', workMode: 'hybrid', requirements: ['TypeScript'], parseState: 'done', parseError: null });
    expect(after.salary).toEqual(parsed().salary);
    expect(after.adContact).toEqual(parsed().adContact);
    expect(after.fieldSources).toMatchObject({ title: 'ai', company: 'ai', salary: 'ai', requirements: 'ai' });
  });

  it('applyParsed never changes a field you typed, even one you cleared', () => {
    const job = create({ capture: pastedCapture('An ad.'), fields: { title: 'My title' } });
    jobs.update(job.id, { company: 'Something' });
    jobs.update(job.id, { company: null });
    const after = jobs.applyParsed(job.id, parsed());
    expect(after.title).toBe('My title');
    expect(after.company).toBeNull();
    expect(after.fieldSources).toMatchObject({ title: 'user', company: 'user', location: 'ai' });
  });

  it("the ad's own data beats the AI, but the AI fills what the ad left empty", () => {
    const job = create({ capture: pastedCapture('An ad.', { structured: { title: 'Engineer (from the page)', location: '' } }) });
    const after = jobs.applyParsed(job.id, parsed());
    expect(after.title).toBe('Engineer (from the page)');
    expect(after.fieldSources.title).toBe('ad');
    expect(after.location).toBe('Sydney NSW');
  });

  it('an empty AI answer never clears a value, and a new AI value replaces an older AI value', () => {
    const job = create({ capture: pastedCapture('An ad.') });
    jobs.applyParsed(job.id, parsed());
    const after = jobs.applyParsed(job.id, parsed({ title: 'Staff Engineer', company: null, requirements: [], workMode: 'unknown', salary: { min: null, max: null, currency: null, period: null, text: null } }));
    expect(after).toMatchObject({ title: 'Staff Engineer', company: 'Atlassian', requirements: ['TypeScript'], workMode: 'hybrid' });
    expect(after.salary.min).toBe(150000);
  });

  it('applyParsed sets parseState done and sends job.updated with what changed', () => {
    const job = create({ capture: pastedCapture('An ad.'), fields: { title: 'Mine' } });
    expect(job.parseState).toBe('pending');
    events = [];
    jobs.applyParsed(job.id, parsed({ title: 'Theirs' }));
    const updated = events.filter(([name]) => name === 'job.updated');
    expect(updated).toHaveLength(1);
    const fields = (updated[0]![1] as { fields: string[] }).fields;
    expect(fields).toContain('company');
    expect(fields).toContain('parseState');
    expect(fields).not.toContain('title');
  });

  it('setParseState failed keeps the reason; setRating stores the whole rating on the job', () => {
    const job = create({ capture: pastedCapture('An ad.') });
    expect(jobs.setParseState(job.id, 'failed', "Can't reach the AI.")).toMatchObject({ parseState: 'failed', parseError: "Can't reach the AI." });
    expect(jobs.setParseState(job.id, 'pending')).toMatchObject({ parseState: 'pending', parseError: null });
    expect(jobs.setParseState(job.id, 'pending', 'Waiting for the AI.')).toMatchObject({ parseState: 'pending', parseError: 'Waiting for the AI.' });
    const rating: Rating = { verdict: 'good', score: 72, why: ['TypeScript'], whyNot: [], dealBreakers: [], salaryNote: null };
    events = [];
    expect(jobs.setRating(job.id, rating)).toMatchObject({ matchVerdict: 'good', matchScore: 72, match: rating });
    expect(events).toEqual([['job.updated', { jobId: job.id, fields: ['match'] }]]);
  });

  it('listIdsByParseState lists unarchived pending jobs, oldest first', () => {
    const a = create({ capture: pastedCapture('Ad A.') });
    clock = new Date('2026-10-28T04:00:00.000Z');
    const b = create({ capture: pastedCapture('Ad B.') });
    const c = create({ capture: pastedCapture('Ad C.') });
    jobs.update(c.id, { archived: true });
    const none = create({ capture: pastedCapture('   ') });
    jobs.applyParsed(b.id, parsed());
    expect(jobs.listIdsByParseState('pending')).toEqual([a.id]);
    expect(jobs.listIdsByParseState('none')).toEqual([none.id]);
  });

  it("a null in the ad's structured data doesn't hide its own title", () => {
    const job = create({ capture: pastedCapture('An ad.', { title: 'From the page', structured: { title: null, company: '  ' } as never, company: 'Canva' }) });
    expect(job).toMatchObject({ title: 'From the page', company: 'Canva' });
  });

  it("a blank typed company falls back to the ad's company when checking for duplicates", () => {
    create({ capture: seekCapture('1'), fields: { title: 'Senior Engineer', company: 'Atlassian' } });
    const res = jobs.save({ capture: seekCapture('2', { company: 'Atlassian', title: 'Senior Engineer' }), fields: { company: '', title: '' } });
    expect(res.result).toBe('needs_decision');
  });
});

describe('jobs service: follow-ups', () => {
  it('sets, changes and clears a follow-up', () => {
    const job = create({ capture: pastedCapture(), fields: { title: 'Engineer' } });
    expect(job).toMatchObject({ followUpOn: null, followUpNote: null });
    expect(jobs.setFollowUp(job.id, { on: '2026-11-05', note: 'Chase Sam' })).toMatchObject({ followUpOn: '2026-11-05', followUpNote: 'Chase Sam' });
    expect(events.at(-1)).toEqual(['job.updated', { jobId: job.id, fields: ['followUpOn', 'followUpNote'] }]);
    expect(jobs.setFollowUp(job.id, { on: '2026-11-07' })).toMatchObject({ followUpOn: '2026-11-07', followUpNote: null });
    expect(jobs.setFollowUp(job.id, { on: null, note: 'ignored' })).toMatchObject({ followUpOn: null, followUpNote: null });
  });

  it('a blank reason is no reason', () => {
    const job = create({ capture: pastedCapture() });
    expect(jobs.setFollowUp(job.id, { on: '2026-11-05', note: '   ' }).followUpNote).toBeNull();
  });

  it("lists what's due and coming up, and leaves out archived jobs and later ones", () => {
    const make = (title: string, on: string) => {
      const job = create({ capture: pastedCapture(title), fields: { title } });
      jobs.setFollowUp(job.id, { on });
      return job;
    };
    // The clock is 28 Oct 2026, 2:15 pm in Sydney.
    make('Late', '2026-10-20');
    make('Today', '2026-10-28');
    make('Soon', '2026-11-04');
    make('Later', '2026-11-05');
    const archived = make('Archived', '2026-10-27');
    jobs.update(archived.id, { archived: true });
    const list = jobs.listFollowUps();
    expect(list.today).toBe('2026-10-28');
    expect(list.due.map((j) => j.title)).toEqual(['Late', 'Today']);
    expect(list.soon.map((j) => j.title)).toEqual(['Soon']);
    expect(list.due[0]).toMatchObject({ followUpOn: '2026-10-20' });
  });

  it('today is the local date, not the UTC one', () => {
    const job = create({ capture: pastedCapture(), fields: { title: 'Engineer' } });
    jobs.setFollowUp(job.id, { on: '2026-10-30' });
    // 1:30 pm UTC on 29 Oct is 12:30 am on 30 Oct in Sydney.
    clock = new Date('2026-10-29T13:30:00.000Z');
    expect(jobs.listFollowUps()).toMatchObject({ today: '2026-10-30', due: [expect.objectContaining({ id: job.id })] });
  });

  it('a follow-up survives status changes, edits and the AI', () => {
    const job = create({ capture: pastedCapture('An ad.') });
    jobs.setFollowUp(job.id, { on: '2026-11-05', note: 'Chase Sam' });
    jobs.changeStatus(job.id, 'rejected', 'manual');
    jobs.update(job.id, { company: 'Xero' });
    jobs.applyParsed(job.id, {
      title: 'Engineer', company: 'Xero', agency: null, location: null, workMode: 'unknown', employmentType: 'unknown',
      salary: { min: null, max: null, currency: null, period: null, text: null }, closingDate: null, summary: 'S',
      requirements: [], niceToHave: [], responsibilities: [], adContact: null,
    });
    jobs.update(job.id, { archived: true });
    jobs.update(job.id, { archived: false });
    expect(jobs.get(job.id)).toMatchObject({ followUpOn: '2026-11-05', followUpNote: 'Chase Sam' });
  });

  it('an unknown job is not found', () => {
    expect(() => jobs.setFollowUp(999, { on: '2026-11-05' })).toThrow(NotFoundError);
  });
});
