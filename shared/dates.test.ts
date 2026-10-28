import { expect, it } from 'vitest';
import { localDate } from './dates.ts';

it('uses the local (Sydney) date, not the UTC date', () => {
  expect(localDate(new Date('2026-10-28T22:30:00Z'))).toBe('2026-10-29');
});

it('formats a midday time as the same day', () => {
  expect(localDate(new Date('2026-10-28T12:00:00Z'))).toBe('2026-10-28');
});
