import { describe, expect, it } from 'vitest';
import type { Candidate } from '../../../shared/contracts/index.ts';
import { likelyText, ratingText, savedText, statusName } from './text.ts';

const now = new Date('2026-10-28T03:15:00Z');

describe('panel wording', () => {
  it('names a status from its id', () => {
    expect(statusName('applied')).toBe('Applied');
    expect(statusName('interview_1')).toBe('Interview 1');
    expect(statusName('final_interview')).toBe('Final interview');
  });

  it('says when a saved job was applied for', () => {
    expect(savedText({ status: 'applied', dateApplied: '2026-10-12' }, now)).toBe('Saved · Applied 12 Oct');
    expect(savedText({ status: 'saved', dateApplied: null }, now)).toBe('Saved');
    expect(savedText({ status: 'screening', dateApplied: null }, now)).toBe('Saved · Screening');
    expect(savedText({ status: 'interview_1', dateApplied: '2025-12-01' }, now)).toBe('Saved · Interview 1 · applied 1 Dec 2025');
  });

  it('describes a likely duplicate the way the dashboard does', () => {
    const c: Candidate = {
      jobId: 4,
      title: 'Senior Engineer',
      company: 'Atlassian',
      agency: null,
      location: null,
      status: 'applied',
      dateApplied: '2026-10-12',
      sourceSites: ['seek', 'linkedin'],
      strength: 'likely',
    };
    expect(likelyText(c, now)).toBe('Looks like Senior Engineer at Atlassian (from Seek and LinkedIn, Applied 12 Oct).');
    expect(likelyText({ ...c, title: null, company: null, agency: 'Hays', sourceSites: ['pasted'], status: 'saved', dateApplied: null }, now)).toBe(
      'Looks like Untitled role at Hays (from pasted text, Saved).',
    );
  });

  it('gives the verdict and score', () => {
    expect(ratingText({ verdict: 'strong', score: 86, why: [], whyNot: [], dealBreakers: [], salaryNote: null })).toBe('Strong match · 86');
  });

  it('says a weak match is only possibly the same job', () => {
    const c: Candidate = {
      jobId: 4, title: 'Analyst', company: null, agency: 'Hays', location: 'Sydney NSW', status: 'saved', dateApplied: null, sourceSites: ['seek'], strength: 'possible',
    };
    expect(likelyText(c, now)).toBe('Possibly the same as Analyst at Hays (from Seek, Saved). It only matches on the role and city.');
  });
});

