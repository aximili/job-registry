import type { EmploymentType, Salary, SalaryPeriod, WorkMode } from '../../../shared/contracts/index.ts';

// How dates, missing values and search snippets are shown.
// Month names are written out by hand so the format never depends on the
// browser's locale data: always "28 Oct 2026".

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDate(localOrIso: string | null): string {
  if (!localOrIso) return '';
  const local = LOCAL_DATE.exec(localOrIso);
  if (local) return `${Number(local[3])} ${MONTHS[Number(local[2]) - 1]} ${local[1]}`;
  const d = new Date(localOrIso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDate(iso);
}

export const displayTitle = (title: string | null): string => title ?? 'Untitled role';
export const displayCompany = (company: string | null): string => company ?? 'Unknown company';

// Search snippets mark matches with \u0001 … \u0002. Splitting them into parts
// lets the page show <mark> without ever inserting raw HTML.
export function snippetParts(snippet: string | null): { text: string; mark: boolean }[] {
  if (!snippet) return [];
  const parts: { text: string; mark: boolean }[] = [];
  for (const [i, piece] of snippet.split(/[\u0001\u0002]/).entries()) {
    if (piece) parts.push({ text: piece, mark: i % 2 === 1 });
  }
  return parts;
}

// "$150,000–170,000 a year". The ad's own wording wins when there is some.
export function formatSalary(salary: Salary): string {
  if (salary.text) return salary.text;
  const { min, max } = salary;
  if (min === null && max === null) return '';
  const range = min !== null && max !== null && min !== max ? `${money(min)}–${money(max)}` : money((min ?? max)!);
  const currency = !salary.currency || salary.currency === 'AUD' ? '$' : `${salary.currency} `;
  const per = salary.period ? PER[salary.period] : '';
  return `${currency}${range}${per}`;
}

const PER: Record<SalaryPeriod, string> = { year: ' a year', day: ' a day', hour: ' an hour' };

function money(n: number): string {
  const [whole, cents] = (Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2)).split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return cents ? `${grouped}.${cents}` : grouped;
}

export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  onsite: 'On site',
  hybrid: 'Hybrid',
  remote: 'Remote',
  unknown: '',
};

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  'full-time': 'Full time',
  'part-time': 'Part time',
  contract: 'Contract',
  temporary: 'Temporary',
  casual: 'Casual',
  unknown: '',
};
