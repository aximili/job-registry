// Turns what you type into a safe SQLite full-text query. Only letters and
// digits survive, each quoted, so symbols like C++, AT&T or a stray quote
// can never break the query syntax.

const MAX_WORDS = 8;

// The same clean-up is applied to indexed text and to queries, so they
// always meet. Text copied from PDFs often holds ligatures (ﬁ, ﬃ) and
// invisible format characters (zero-width spaces, soft hyphens).
export function searchable(text: string): string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '');
}

export function buildFtsQuery(q: string): string | null {
  const words = searchable(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) return null;
  return words
    .slice(0, MAX_WORDS)
    .map((word) => `"${word}"*`)
    .join(' ');
}
