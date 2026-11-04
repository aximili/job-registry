import { describe, expect, it } from 'vitest';
import type { PrepPlan } from '../../../shared/contracts/index.ts';
import { hoursText, learnSummary, planDate, planProgressText, shownPlan } from './prep.ts';

function plan(id: number, createdAt: string): PrepPlan {
  return {
    id,
    jobId: 3,
    by: 'Bonsai 2',
    createdAt,
    learn: [
      { topic: 'Go basics', why: 'The ad lists Go.', steps: ['Read about Go.', 'Rewrite a script.'], hours: 4, afterwards: 'I know Go basics.' },
      { topic: 'Caching', why: 'Fast builds.', steps: [], hours: 1.5, afterwards: 'I can explain caching.' },
    ],
    project: { title: 'A build dashboard', what: 'Shows build times.', touches: ['Go'], hours: 6, afterwards: 'I built it.' },
    interview: [{ question: 'Made developers faster?', story: 'Cutting build times.' }],
    ask: [
      { question: 'A typical week?', why: 'The ad is quiet on it.' },
      { question: 'Where is Go used?', why: 'The ad lists both.' },
    ],
    refresh: [],
  };
}

describe('the plan’s progress line', () => {
  it('says who it waits for, then who is making it', () => {
    expect(planProgressText({ phase: 'waiting', by: 'Bonsai 2' })).toBe('Waiting for Bonsai 2…');
    expect(planProgressText({ phase: 'working', by: 'Claude – mine' })).toBe('Claude – mine is making your plan…');
  });
});

describe('hours', () => {
  it('reads as minutes under an hour, and as hours from one', () => {
    expect(hoursText(0.25)).toBe('15 minutes');
    expect(hoursText(0.5)).toBe('30 minutes');
    expect(hoursText(1)).toBe('1 hour');
    expect(hoursText(1.5)).toBe('1.5 hours');
    expect(hoursText(8)).toBe('8 hours');
  });
});

describe('a plan’s date', () => {
  it('gives the day and the time, so two plans on one day differ', () => {
    expect(planDate('2026-11-04T03:05:00.000Z', 'Australia/Sydney')).toBe('4 Nov 2026, 2:05 pm');
    expect(planDate('2026-11-03T13:30:00.000Z', 'Australia/Sydney')).toBe('4 Nov 2026, 12:30 am');
    expect(planDate('2026-11-04T01:00:00.000Z', 'Australia/Sydney')).toBe('4 Nov 2026, 12:00 pm');
  });
});

describe('the plan on screen', () => {
  const plans = [plan(9, '2026-11-04T03:00:00.000Z'), plan(4, '2026-11-03T03:00:00.000Z')];

  it('is the newest, unless you opened an earlier one', () => {
    expect(shownPlan(plans, null)?.id).toBe(9);
    expect(shownPlan(plans, 4)?.id).toBe(4);
  });

  it('is the newest again when the one you opened has gone', () => {
    expect(shownPlan(plans, 2)?.id).toBe(9);
    expect(shownPlan([], null)).toBeNull();
  });
});

describe('learn in a day, in a line', () => {
  it('counts the topics and adds up their hours', () => {
    expect(learnSummary(plan(1, '2026-11-04T03:00:00.000Z'))).toBe('2 topics · 5.5 hours');
    const one = plan(1, '2026-11-04T03:00:00.000Z');
    expect(learnSummary({ ...one, learn: one.learn.slice(0, 1) })).toBe('1 topic · 4 hours');
  });
});
