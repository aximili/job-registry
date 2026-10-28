import { describe, expect, it } from 'vitest';
import { FAKE_PARSED } from './fakes/fake-ai-provider.ts';
import { scoreParse } from '../scripts/eval-score.ts';

describe('scoreParse', () => {
  it('only scores the fields the expected answer gives', () => {
    expect(Object.keys(scoreParse({ title: 'Senior Engineer' }, FAKE_PARSED))).toEqual(['title']);
  });

  it('text matches ignore case, spaces and company endings', () => {
    expect(scoreParse({ company: 'atlassian' }, { ...FAKE_PARSED, company: ' Atlassian  Pty Ltd ' })).toEqual({ company: true });
    expect(scoreParse({ company: 'Canva' }, FAKE_PARSED)).toEqual({ company: false });
    expect(scoreParse({ agency: null }, FAKE_PARSED)).toEqual({ agency: true });
  });

  it('salary min and max match within 1%, and the period must match', () => {
    const salary = (min: number, max: number, period: 'year' | 'hour' = 'year') => ({ ...FAKE_PARSED.salary, min, max, period });
    expect(scoreParse({ salary: salary(90000, 110000) }, { ...FAKE_PARSED, salary: salary(90500, 110000) })).toEqual({ salary: true });
    expect(scoreParse({ salary: salary(90000, 110000) }, { ...FAKE_PARSED, salary: salary(95000, 110000) })).toEqual({ salary: false });
    expect(scoreParse({ salary: salary(90000, 110000) }, { ...FAKE_PARSED, salary: salary(90000, 110000, 'hour') })).toEqual({ salary: false });
  });

  it('enums and dates must be exactly equal', () => {
    expect(scoreParse({ workMode: 'hybrid', closingDate: null }, FAKE_PARSED)).toEqual({ workMode: true, closingDate: true });
    expect(scoreParse({ workMode: 'remote' }, FAKE_PARSED)).toEqual({ workMode: false });
  });

  it('a list passes when at least 70% of the expected items are found, by words', () => {
    const actual = { ...FAKE_PARSED, requirements: ['Strong TypeScript skills', 'Five years building web apps', 'AWS'] };
    expect(scoreParse({ requirements: ['TypeScript', 'AWS', '5+ years building web apps'] }, actual)).toEqual({ requirements: true });
    expect(scoreParse({ requirements: ['Go', 'Kubernetes', 'AWS'] }, actual)).toEqual({ requirements: false });
    expect(scoreParse({ requirements: [] }, { ...actual, requirements: [] })).toEqual({ requirements: true });
  });
});
