// A line-by-line diff, for showing what a newer starter guide changes.
// It keeps the longest run of lines the two texts share, and marks the rest
// as removed (only in the first) or added (only in the second). Within each
// change, the removed lines come first.

import type { DiffLine } from './contracts/index.ts';

// Windows and old Mac line endings, a byte-order mark and the line break at
// the end don't count as changes. The profile module compares starter guides
// the same way (normaliseStarter).
export function normaliseLines(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
}

function linesOf(text: string): string[] {
  const flat = normaliseLines(text);
  return flat === '' ? [] : flat.split('\n');
}

export function lineDiff(from: string, to: string): DiffLine[] {
  const a = linesOf(from);
  const b = linesOf(to);
  // Lines both texts start and end with need no table.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const n = a.length - start - end;
  const m = b.length - start - end;

  // longest[i * (m + 1) + j]: the most lines a[start + i..] and b[start + j..] share, in order.
  const longest = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => longest[i * (m + 1) + j]!;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      longest[i * (m + 1) + j] = a[start + i] === b[start + j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const out: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      out.push({ kind: 'same', text: a[start + i]! });
      i++;
      j++;
    } else if (i < n && (j === m || at(i + 1, j) >= at(i, j + 1))) {
      out.push({ kind: 'removed', text: a[start + i]! });
      i++;
    } else {
      out.push({ kind: 'added', text: b[start + j]! });
      j++;
    }
  }
  for (const text of a.slice(a.length - end)) out.push({ kind: 'same', text });
  return out;
}
