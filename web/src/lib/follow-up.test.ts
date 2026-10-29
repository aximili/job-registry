import { describe, expect, it } from 'vitest';
import { addDays, lateness, QUICK_PICKS } from './follow-up.ts';

describe('follow-up dates', () => {
  it.each([
    ['2026-10-29', 1, '2026-10-30'],
    ['2026-10-29', 7, '2026-11-05'],
    ['2026-12-28', 7, '2027-01-04'],
    ['2026-03-31', -1, '2026-03-30'],
    // Daylight saving starts in Sydney on 4 Oct 2026: still one calendar day.
    ['2026-10-03', 1, '2026-10-04'],
  ])('%s plus %i days is %s', (from, days, to) => {
    expect(addDays(from, days)).toBe(to);
  });

  it('says how late a follow-up is', () => {
    expect(lateness('2026-10-29', '2026-10-29')).toBe('Today');
    expect(lateness('2026-10-28', '2026-10-29')).toBe('1 day late');
    expect(lateness('2026-10-26', '2026-10-29')).toBe('3 days late');
    expect(lateness('2026-10-30', '2026-10-29')).toBe('');
  });

  it('offers the usual gaps', () => {
    expect(QUICK_PICKS).toEqual([
      { label: 'Tomorrow', days: 1 },
      { label: 'In 3 days', days: 3 },
      { label: 'In a week', days: 7 },
      { label: 'In 2 weeks', days: 14 },
    ]);
  });
});
