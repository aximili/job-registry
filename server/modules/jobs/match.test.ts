import { describe, expect, it } from 'vitest';
import { findCandidates, titleSimilarity, type MatchableJob } from './match.ts';

function job(id: number, extra: Partial<MatchableJob>): MatchableJob {
  return {
    id,
    title: 'Senior Engineer',
    company: 'Atlassian',
    agency: null,
    location: 'Sydney NSW',
    status: 'applied',
    dateApplied: '2026-10-12',
    createdAt: '2026-10-12T00:00:00.000Z',
    sourceSites: ['seek'],
    ...extra,
  };
}

describe('titleSimilarity', () => {
  it.each([
    ['Senior Software Engineer', 'Software Engineer (Senior)', 1],
    ['Sr. Software Engineer', 'Senior Software Engineer', 1],
    ['Senior Software Engineer - Platform', 'Senior Software Engineer', 0.75],
    ['Software Engineer', 'Data Engineer', 1 / 3],
  ])('%s vs %s', (a, b, expected) => {
    expect(titleSimilarity(a, b)).toBeCloseTo(expected);
  });
});

describe('findCandidates', () => {
  it('same company and close title is a likely match', () => {
    const [match] = findCandidates({ title: 'Senior Engineer', company: 'Atlassian Pty Ltd' }, [job(1, {})]);
    expect(match).toMatchObject({ jobId: 1, strength: 'likely', sourceSites: ['seek'] });
  });

  it('agency ad with no employer, same title and city is a possible match', () => {
    expect(findCandidates({ title: 'Senior Engineer', location: 'Sydney' }, [job(1, {})])[0]?.strength).toBe('possible');
    const viaAgency = findCandidates({ title: 'Senior Engineer', company: 'Hays', location: 'Sydney CBD' }, [job(2, { agency: 'Hays' })]);
    expect(viaAgency[0]).toMatchObject({ jobId: 2, strength: 'possible' });
  });

  it('different real companies are never matched', () => {
    expect(findCandidates({ title: 'Senior Engineer', company: 'Canva', location: 'Sydney' }, [job(1, {})])).toEqual([]);
  });

  it('a different city is not a possible match', () => {
    expect(findCandidates({ title: 'Senior Engineer', location: 'Melbourne VIC' }, [job(1, {})])).toEqual([]);
  });

  it('returns at most 3 candidates, likely first, then most similar, then newest', () => {
    const jobs = [
      job(1, { company: null, createdAt: '2026-10-01T00:00:00.000Z' }),
      job(2, { company: null, createdAt: '2026-10-20T00:00:00.000Z' }),
      job(3, { title: 'Senior Engineer - Platform' }),
      job(4, {}),
      job(5, { company: null, title: 'Senior Engineer II', createdAt: '2026-10-25T00:00:00.000Z' }),
    ];
    const ids = findCandidates({ title: 'Senior Engineer', company: 'Atlassian', location: 'Sydney' }, jobs).map((c) => c.jobId);
    expect(ids).toEqual([4, 3, 2]);
  });
});
