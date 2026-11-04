// What a newer starter guide changes, made short enough to read: each run of
// unchanged lines keeps a few lines beside each change, and the rest of it
// folds into one part you can open.

import type { DiffLine } from '../../../shared/contracts/index.ts';

export type DiffPart = { kind: 'line'; line: DiffLine } | { kind: 'fold'; lines: DiffLine[] };

// A fold that would hide just one line takes as much room as the line.
const LEAST_FOLDED = 2;

export function foldDiff(diff: DiffLine[], context = 2): DiffPart[] {
  const out: DiffPart[] = [];
  let i = 0;
  while (i < diff.length) {
    if (diff[i]!.kind !== 'same') {
      out.push({ kind: 'line', line: diff[i]! });
      i++;
      continue;
    }
    let end = i;
    while (end < diff.length && diff[end]!.kind === 'same') end++;
    const run = diff.slice(i, end);
    // Keep lines only on a side that has a change.
    const before = i > 0 ? context : 0;
    const after = end < diff.length ? context : 0;
    if (run.length - before - after >= LEAST_FOLDED) {
      for (const line of run.slice(0, before)) out.push({ kind: 'line', line });
      out.push({ kind: 'fold', lines: run.slice(before, run.length - after) });
      for (const line of run.slice(run.length - after)) out.push({ kind: 'line', line });
    } else {
      for (const line of run) out.push({ kind: 'line', line });
    }
    i = end;
  }
  return out;
}
