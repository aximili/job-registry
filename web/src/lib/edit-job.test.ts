import { describe, expect, it } from 'vitest';
import type { Job } from '../../../shared/contracts/index.ts';
import { buildPatch, formFromJob } from './edit-job.ts';

const job: Job = {
  id: 1,
  title: 'Senior Engineer',
  company: 'Atlassian',
  agency: null,
  location: 'Sydney NSW',
  workMode: 'hybrid',
  employmentType: 'full-time',
  salary: { min: 150000, max: 170000, currency: 'AUD', period: 'year', text: null },
  closingDate: null,
  summary: null,
  requirements: ['TypeScript', 'Node.js'],
  niceToHave: [],
  responsibilities: [],
  dateApplied: null,
  status: 'saved',
  adContact: null,
  fieldSources: { title: 'ai', salary: 'ai' },
  parseState: 'done',
  parseError: null,
  matchVerdict: null,
  matchScore: null,
  match: null,
  archived: false,
  createdAt: '2026-10-28T03:15:00.000Z',
  updatedAt: '2026-10-28T03:15:00.000Z',
};

describe('edit job', () => {
  it('a patch holds only the fields you changed', () => {
    const start = formFromJob(job);
    const now = { ...start, title: 'Staff Engineer', requirements: 'TypeScript\n\n  Go  \n' };
    expect(buildPatch(start, now, job)).toEqual({ title: 'Staff Engineer', requirements: ['TypeScript', 'Go'] });
  });

  it('a salary shown from min and max is sent only if you change it, keeping min and max', () => {
    const start = formFromJob(job);
    expect(start.salary).toBe('$150,000–170,000 a year');
    expect(buildPatch(start, { ...start }, job)).toEqual({});
    const patch = buildPatch(start, { ...start, salary: '$160k plus super' }, job);
    expect(patch).toEqual({ salary: { min: 150000, max: 170000, currency: 'AUD', period: 'year', text: '$160k plus super' } });
  });

  it('no changes means an empty patch; blank dates become null', () => {
    const start = formFromJob({ ...job, closingDate: '2026-11-30' });
    expect(buildPatch(start, { ...start }, job)).toEqual({});
    expect(buildPatch(start, { ...start, closingDate: '' }, job)).toEqual({ closingDate: null });
  });

  it('clearing the salary box clears the whole salary, min and max too', () => {
    const start = formFromJob(job);
    expect(buildPatch(start, { ...start, salary: '  ' }, job)).toEqual({
      salary: { min: null, max: null, currency: null, period: null, text: null },
    });
  });
});

