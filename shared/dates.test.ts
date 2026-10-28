import { expect, it } from 'vitest';
import { localDate } from './dates.ts';

it('uses the local (Sydney) date, not the UTC date', () => {
  expect(localDate(new Date('2026-10-28T22:30:00Z'))).toBe('2026-10-29');
});

it('formats a midday time as the same day', () => {
  expect(localDate(new Date('2026-10-28T12:00:00Z'))).toBe('2026-10-28');
});

it('formatDate writes dates the Australian way', async () => {
  const { formatDate } = await import('./dates.ts');
  expect(formatDate('2026-10-28')).toBe('28 Oct 2026');
  expect(formatDate('2026-01-05T03:00:00Z')).toBe('5 Jan 2026');
  expect(formatDate(null)).toBe('');
});

it('shortDate leaves out this year, for the extension panel', async () => {
  const { shortDate } = await import('./dates.ts');
  const now = new Date('2026-10-28T03:15:00Z');
  expect(shortDate('2026-10-12', now)).toBe('12 Oct');
  expect(shortDate('2025-12-01', now)).toBe('1 Dec 2025');
  expect(shortDate(null, now)).toBe('');
});
