import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUSES, type JobSummary } from '../../../shared/contracts/index.ts';
import { boardColumns } from './board.ts';

const statuses = DEFAULT_STATUSES.map((s) => ({ ...s }));

function job(id: number, status: string, updatedAt = `2026-10-${String(10 + id).padStart(2, '0')}T00:00:00.000Z`): JobSummary {
  return {
    id,
    title: `Job ${id}`,
    company: 'Acme',
    agency: null,
    location: null,
    status,
    dateApplied: null,
    archived: false,
    followUpOn: null,
    followUpNote: null,
    updatedAt,
  };
}

describe('boardColumns', () => {
  it('one column per open status, in order', () => {
    const columns = boardColumns([job(1, 'applied'), job(2, 'saved')], statuses, { showClosed: false });
    expect(columns.map((c) => c.id)).toEqual(['saved', 'applied', 'screening', 'interview_1', 'interview_2', 'final_interview', 'offer', 'accepted']);
    expect(columns[0]).toMatchObject({ label: 'Saved', closed: false, jobs: [expect.objectContaining({ id: 2 })] });
  });

  it('closed columns only when asked', () => {
    const jobs = [job(1, 'rejected'), job(2, 'applied')];
    expect(boardColumns(jobs, statuses, { showClosed: false }).flatMap((c) => c.jobs.map((j) => j.id))).toEqual([2]);
    const all = boardColumns(jobs, statuses, { showClosed: true });
    expect(all.map((c) => c.id).slice(-3)).toEqual(['rejected', 'withdrawn', 'no_response']);
    expect(all.find((c) => c.id === 'rejected')).toMatchObject({ closed: true, jobs: [expect.objectContaining({ id: 1 })] });
  });

  it('newest first in each column', () => {
    const columns = boardColumns([job(1, 'applied'), job(2, 'applied'), job(3, 'applied')], statuses, { showClosed: false });
    expect(columns.find((c) => c.id === 'applied')!.jobs.map((j) => j.id)).toEqual([3, 2, 1]);
  });

  it('follows the order in your settings, not the list order', () => {
    const columns = boardColumns([], [...statuses].reverse(), { showClosed: false });
    expect(columns[0]!.id).toBe('saved');
  });

  it('a job with a status your settings no longer have goes in Other', () => {
    const columns = boardColumns([job(1, 'phone_screen'), job(2, 'applied')], statuses, { showClosed: false });
    expect(columns.at(-1)).toEqual({ id: '__other', label: 'Other', closed: false, jobs: [expect.objectContaining({ id: 1 })] });
  });

  it('no Other column when every status is known', () => {
    expect(boardColumns([job(1, 'applied')], statuses, { showClosed: true }).some((c) => c.id === '__other')).toBe(false);
  });
});
