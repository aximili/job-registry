// Scores how well the AI read a job ad, field by field, against answers
// filled in by hand. Used by `npm run eval:parse`. It's forgiving about
// wording (case, spacing, "Pty Ltd", list items said a little differently)
// and strict about numbers, dates and choices.

import type { ParsedJob } from '../shared/contracts/index.ts';

const TEXT = new Set(['title', 'company', 'agency', 'location', 'summary']);
const LISTS = new Set(['requirements', 'niceToHave', 'responsibilities']);

function normalise(text: string | null): string | null {
  if (text === null) return null;
  const t = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[,.]?\s*(pty\.? ?ltd\.?|limited|ltd\.?)$/, '')
    .trim();
  return t || null;
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length > 1 || /\d/.test(w));

// An expected item is found when at least half its words are in one actual item.
function listMatches(expected: string[], actual: string[]): boolean {
  if (expected.length === 0) return actual.length === 0;
  const pools = actual.map((a) => new Set(words(a)));
  const found = expected.filter((item) => {
    const want = words(item);
    if (want.length === 0) return true;
    return pools.some((pool) => want.filter((w) => pool.has(w)).length >= want.length / 2);
  });
  return found.length / expected.length >= 0.7;
}

const near = (a: number | null, b: number | null): boolean =>
  a === null || b === null ? a === b : Math.abs(a - b) <= Math.abs(a) * 0.01;

export function scoreParse(expected: Partial<ParsedJob>, actual: ParsedJob): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [key, want] of Object.entries(expected) as [keyof ParsedJob, unknown][]) {
    const got = actual[key];
    if (TEXT.has(key)) out[key] = normalise(want as string | null) === normalise(got as string | null);
    else if (LISTS.has(key)) out[key] = listMatches(want as string[], got as string[]);
    else if (key === 'salary') {
      const w = want as ParsedJob['salary'];
      const g = got as ParsedJob['salary'];
      out[key] = near(w.min, g.min) && near(w.max, g.max) && w.period === g.period;
    } else out[key] = JSON.stringify(want) === JSON.stringify(got);
  }
  return out;
}
