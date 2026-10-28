const pad = (n: number): string => String(n).padStart(2, '0');

// A calendar date (YYYY-MM-DD) in the computer's own timezone.
// Never use toISOString() for this: it gives the UTC date, which is
// a day behind in Australia every morning.
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
