import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUSES, type EmailEvent } from './contracts/index.ts';
import { suggestStatus } from './email-status.ts';

const statuses = DEFAULT_STATUSES.map((s) => ({ ...s }));

describe('suggestStatus', () => {
  it.each<[EmailEvent, string, string | null]>([
    ['received', 'saved', 'applied'],
    ['received', 'applied', null],
    ['received', 'interview_1', null],
    ['received', 'rejected', null],
    ['rejected', 'screening', 'rejected'],
    ['rejected', 'offer', 'rejected'],
    ['rejected', 'no_response', null],
    ['rejected', 'rejected', null],
    ['interview', 'applied', 'interview_1'],
    ['interview', 'interview_1', 'interview_2'],
    ['interview', 'interview_2', 'final_interview'],
    ['interview', 'final_interview', null],
    ['interview', 'no_response', 'interview_1'],
    ['assessment', 'applied', 'screening'],
    ['assessment', 'interview_1', null],
    ['offer', 'final_interview', 'offer'],
    ['offer', 'rejected', 'offer'],
    ['offer', 'offer', null],
    ['other', 'applied', null],
  ])('%s from %s → %s', (event, current, expected) => {
    expect(suggestStatus(event, current, statuses)).toBe(expected);
  });

  it('suggests nothing for a status your settings no longer have', () => {
    const noScreening = statuses.filter((s) => s.id !== 'screening');
    expect(suggestStatus('assessment', 'applied', noScreening)).toBeNull();
  });

  it('treats a status it does not know as the earliest', () => {
    expect(suggestStatus('received', 'old_status', statuses)).toBe('applied');
  });

  it('follows the order in your settings, not the list order', () => {
    const shuffled = [...statuses].reverse();
    expect(suggestStatus('interview', 'interview_1', shuffled)).toBe('interview_2');
  });
});
