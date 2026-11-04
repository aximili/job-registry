// The job page's "Get ready": the words around a prep plan (who's making
// it, the hours, an earlier plan's date) and which plan is on screen.

import type { PrepPlan } from '../../../shared/contracts/index.ts';
import { formatDate } from '../../../shared/dates.ts';
import { plural } from './format.ts';

export type PlanProgress = { phase: 'waiting' | 'working'; by: string };

export function planProgressText(p: PlanProgress): string {
  return p.phase === 'waiting' ? `Waiting for ${p.by}…` : `${p.by} is making your plan…`;
}

// "15 minutes" under an hour, then "1 hour", "1.5 hours".
export function hoursText(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  const n = Math.round(hours * 100) / 100;
  return n === 1 ? '1 hour' : `${n} hours`;
}

// "4 Nov 2026, 2:05 pm": with the time, so two plans made on one day differ.
// The numbers come from the computer's clock (or timeZone, for tests); the
// words are written by hand, as every date in the app is.
export function planDate(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const hour = get('hour');
  const minute = String(get('minute')).padStart(2, '0');
  const day = `${get('year')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`;
  return `${formatDate(day)}, ${hour % 12 || 12}:${minute} ${hour < 12 ? 'am' : 'pm'}`;
}

// The plan you opened from Earlier plans, or else the newest. Plans come
// newest first.
export function shownPlan(plans: PrepPlan[], openId: number | null): PrepPlan | null {
  return plans.find((p) => p.id === openId) ?? plans[0] ?? null;
}

// Learn in a day, in a line: "3 topics · 9 hours".
export function learnSummary(plan: PrepPlan): string {
  const hours = plan.learn.reduce((sum, t) => sum + t.hours, 0);
  return `${plural(plan.learn.length, 'topic')} · ${hoursText(hours)}`;
}
