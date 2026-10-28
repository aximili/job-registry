const pad = (n: number): string => String(n).padStart(2, '0');

// A calendar date (YYYY-MM-DD) in the computer's own timezone.
// Never use toISOString() for this: it gives the UTC date, which is
// a day behind in Australia every morning.
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// How dates are shown: always "28 Oct 2026", with month names written out by
// hand so the format never depends on the browser's locale data. Used by the
// dashboard and the extension.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(localOrIso: string | null): { day: number; month: string; year: number } | null {
  if (!localOrIso) return null;
  const local = LOCAL_DATE.exec(localOrIso);
  if (local) return { day: Number(local[3]), month: MONTHS[Number(local[2]) - 1]!, year: Number(local[1]) };
  const d = new Date(localOrIso);
  if (Number.isNaN(d.getTime())) return null;
  return { day: d.getDate(), month: MONTHS[d.getMonth()]!, year: d.getFullYear() };
}

export function formatDate(localOrIso: string | null): string {
  const p = parts(localOrIso);
  return p ? `${p.day} ${p.month} ${p.year}` : '';
}

// "12 Oct" this year, "1 Dec 2025" otherwise.
export function shortDate(localOrIso: string | null, now: Date = new Date()): string {
  const p = parts(localOrIso);
  if (!p) return '';
  return p.year === now.getFullYear() ? `${p.day} ${p.month}` : `${p.day} ${p.month} ${p.year}`;
}

