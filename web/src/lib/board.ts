// The board's columns: one per status, in your order, each with its jobs
// newest first. A job whose status your settings no longer have goes in an
// "Other" column, so it never disappears from the board.

import type { JobSummary, Status } from '../../../shared/contracts/index.ts';

export type BoardColumn = { id: string; label: string; closed: boolean; jobs: JobSummary[] };

export const OTHER = '__other';

// What a dragged card carries. Only this type counts as a card on a drop.
export const JOB_DRAG_TYPE = 'application/x-job-registry-job';

export function boardColumns(jobs: JobSummary[], statuses: Status[], o: { showClosed: boolean }): BoardColumn[] {
  const newest = (a: JobSummary, b: JobSummary) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id;
  const known = new Set(statuses.map((s) => s.id));
  const columns: BoardColumn[] = [...statuses]
    .sort((a, b) => a.order - b.order)
    .filter((s) => o.showClosed || !s.closed)
    .map((s) => ({ id: s.id, label: s.label, closed: s.closed, jobs: jobs.filter((j) => j.status === s.id).sort(newest) }));
  const other = jobs.filter((j) => !known.has(j.status)).sort(newest);
  if (other.length > 0) columns.push({ id: OTHER, label: 'Other', closed: false, jobs: other });
  return columns;
}
