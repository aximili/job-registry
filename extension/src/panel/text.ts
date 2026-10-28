// What the panel says, as plain functions, so the wording can be tested.

import type { Candidate, Rating } from '../../../shared/contracts/index.ts';
import { shortDate } from '../../../shared/dates.ts';
import { SITE_NAME, joinList, verdictLabel } from '../../../shared/labels.ts';

// The extension doesn't know your status labels, so it names the default ids
// the way Settings does: "interview_1" is "Interview 1".
export function statusName(id: string): string {
  const words = id.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function savedText(job: { status: string; dateApplied: string | null }, now: Date): string {
  const status = statusName(job.status);
  if (!job.dateApplied) return job.status === 'saved' ? 'Saved' : `Saved · ${status}`;
  if (job.status === 'applied') return `Saved · ${status} ${shortDate(job.dateApplied, now)}`;
  return `Saved · ${status} · applied ${shortDate(job.dateApplied, now)}`;
}

export function likelyText(c: Candidate, now: Date): string {
  const sites = joinList(c.sourceSites.map((s) => SITE_NAME[s]));
  const status = [statusName(c.status), shortDate(c.dateApplied, now)].filter(Boolean).join(' ');
  const job = `${c.title ?? 'Untitled role'} at ${c.company ?? c.agency ?? 'an unknown company'} (from ${sites}, ${status})`;
  // A weak match (an agency ad that hides the employer) is only a maybe.
  return c.strength === 'possible' ? `Possibly the same as ${job}. It only matches on the role and city.` : `Looks like ${job}.`;
}

export function ratingText(r: Rating): string {
  return `${verdictLabel(r.verdict)} · ${r.score}`;
}
