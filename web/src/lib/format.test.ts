import { describe, expect, it } from 'vitest';
import { displayCompany, displayTitle, formatDate, formatRelative, formatSalary, snippetParts } from './format.ts';

describe('formatDate', () => {
  it('shows dates the Australian way', () => {
    expect(formatDate('2026-10-28')).toBe('28 Oct 2026');
    expect(formatDate('2026-01-05T03:00:00Z')).toBe('5 Jan 2026');
    expect(formatDate(null)).toBe('');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-10-28T03:15:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it.each([
    [ago(10_000), 'just now'],
    [ago(5 * 60_000), '5 min ago'],
    [ago(60 * 60_000), '1 hour ago'],
    [ago(3 * 3_600_000), '3 hours ago'],
    [ago(30 * 3_600_000), 'yesterday'],
    [ago(4 * 86_400_000), '4 days ago'],
    [ago(9 * 86_400_000), '19 Oct 2026'],
    [new Date(now.getTime() + 60_000).toISOString(), 'just now'],
  ])('%s → %s', (iso, expected) => {
    expect(formatRelative(iso, now)).toBe(expected);
  });
});

describe('placeholders', () => {
  it('fills in a missing title or company', () => {
    expect(displayTitle(null)).toBe('Untitled role');
    expect(displayCompany(null)).toBe('Unknown company');
    expect(displayTitle('Engineer')).toBe('Engineer');
  });
});

describe('snippetParts', () => {
  it('splits a snippet into plain and marked parts', () => {
    expect(snippetParts('Great \u0001flexible\u0002 hours <b>')).toEqual([
      { text: 'Great ', mark: false },
      { text: 'flexible', mark: true },
      { text: ' hours <b>', mark: false },
    ]);
    expect(snippetParts(null)).toEqual([]);
  });
});

describe('formatSalary', () => {
  const none = { min: null, max: null, currency: null, period: null, text: null };
  it('prefers the text from the ad, then builds a range', () => {
    expect(formatSalary({ ...none, text: '$185k–$200k + super' })).toBe('$185k–$200k + super');
    expect(formatSalary({ ...none, min: 150000, max: 170000, currency: 'AUD', period: 'year' })).toBe('$150,000–170,000 a year');
    expect(formatSalary({ ...none, min: 55.5, max: 55.5, currency: 'AUD', period: 'hour' })).toBe('$55.50 an hour');
    expect(formatSalary({ ...none, min: 900, currency: 'NZD', period: 'day' })).toBe('NZD 900 a day');
    expect(formatSalary(none)).toBe('');
  });
});
