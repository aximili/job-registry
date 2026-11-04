import { describe, expect, it } from 'vitest';
import type { Job } from './contracts/index.ts';
import { describeJob, jobNotes } from './job-text.ts';

it("gives a job's notes to a writing task in the order given, with each note's time", () => {
  const note = (id: number, body: string, createdAt: string) => ({ id, jobId: 1, body, createdAt, updatedAt: createdAt });
  expect(jobNotes([note(2, 'Newer.', '2026-11-03T02:00:00.000Z'), note(1, 'Older.', '2026-11-02T02:00:00.000Z')])).toEqual([
    { at: '2026-11-03T02:00:00.000Z', text: 'Newer.' },
    { at: '2026-11-02T02:00:00.000Z', text: 'Older.' },
  ]);
  expect(jobNotes([])).toEqual([]);
});

describe('describeJob', () => {
  const JOB: Job = {
    id: 1,
    title: 'Senior Engineer',
    company: 'Example Co',
    agency: 'Example Recruit',
    location: 'Sydney NSW',
    workMode: 'hybrid',
    employmentType: 'full-time',
    salary: { min: null, max: null, currency: null, period: null, text: null },
    closingDate: null,
    summary: null,
    requirements: ['TypeScript'],
    niceToHave: [],
    responsibilities: [],
    dateApplied: null,
    status: 'open',
    adContact: null,
    fieldSources: {},
    parseState: 'done',
    parseError: null,
    matchVerdict: null,
    matchScore: null,
    match: null,
    archived: false,
    followUpOn: null,
    followUpNote: null,
    createdAt: '2026-11-03T02:00:00.000Z',
    updatedAt: '2026-11-03T02:00:00.000Z',
  };

  // The writer needs who to write to, and the ad's contact may be only in a mailto: link.
  it("gives the ad's contact, with whichever of the name, email and phone are known, before the long lists", () => {
    const full = describeJob({ ...JOB, adContact: { name: 'Alex Chen', email: 'alex@example-recruit.com.au', phone: '0400 000 000' } });
    expect(full).toBe(
      'Role: Senior Engineer\nCompany: Example Co\nRecruiter: Example Recruit\nContact: Alex Chen, alex@example-recruit.com.au, 0400 000 000\nLocation: Sydney NSW\nWork mode: Hybrid\nRequirements:\n- TypeScript',
    );
    expect(describeJob({ ...JOB, adContact: { name: null, email: 'alex@example-recruit.com.au', phone: null } })).toContain(
      '\nContact: alex@example-recruit.com.au\n',
    );
    expect(describeJob({ ...JOB, adContact: { name: '  ', email: null, phone: null } })).not.toContain('Contact:');
    expect(describeJob(JOB)).not.toContain('Contact:');
  });
});
