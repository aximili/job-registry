// Follow-up dates are local calendar dates (YYYY-MM-DD), like date applied.

import { localDate } from '../../../shared/dates.ts';

export const QUICK_PICKS: { label: string; days: number }[] = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'In a week', days: 7 },
  { label: 'In 2 weeks', days: 14 },
];

// Calendar days, so a change to daylight saving never skips or repeats a day.
export function addDays(local: string, days: number): string {
  const [y, m, d] = local.split('-').map(Number);
  return localDate(new Date(y!, m! - 1, d! + days));
}

function daysBetween(from: string, to: string): number {
  const at = (local: string) => {
    const [y, m, d] = local.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

// "Today", "1 day late", "3 days late", or "" when it's still to come.
export function lateness(on: string, today: string): string {
  const late = daysBetween(on, today);
  if (late < 0) return '';
  if (late === 0) return 'Today';
  return `${late} day${late === 1 ? '' : 's'} late`;
}

export function today(): string {
  return localDate(new Date());
}
