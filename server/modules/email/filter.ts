// The cheap first filter: plain code that keeps only emails that look like
// they're about one of your jobs, so the AI reads a handful, not your whole
// inbox. It also says which jobs an email might be about, for the AI to pick from.

import { compactCompany, normaliseCompany, words } from '../../../shared/company.ts';

export type FilterJob = { id: number; company: string | null; agency: string | null; contactEmails: string[]; updatedAt: string };
export type FilterResult = { pass: boolean; jobIds: number[]; reason: 'contact' | 'domain' | 'name' | 'keyword' | null };

const MAX_JOBS = 5;
const TEXT_LIMIT = 4000;

// Anyone can have an address at these, so the domain alone says nothing.
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com',
  'bigpond.com', 'proton.me', 'protonmail.com',
]);

// Parts of a web address that never name the company.
const NOISE_LABELS = new Set([
  'com', 'net', 'org', 'gov', 'edu', 'io', 'co', 'au', 'nz', 'uk',
  'mail', 'email', 'e', 'careers', 'jobs', 'hr', 'talent', 'recruiting', 'notifications', 'noreply', 'no-reply', 'info', 'news',
]);

// Phrases that only an email about an application uses.
const STRONG = [
  'your application', 'application for', 'application to', 'thank you for applying', 'thanks for applying',
  'application received', 'received your application', 'not progressing', 'not be progressing', 'unsuccessful',
  'shortlisted', 'invitation to interview', 'interview invitation', 'invite you to an interview', 'schedule an interview',
  'online assessment', 'coding challenge', 'offer of employment', 'letter of offer', 'job offer',
];
// Words that, next to a company's name, make an email worth reading.
const BROAD = [...STRONG, 'interview', 'assessment', 'unfortunately', 'offer', 'application', 'applied', 'position', 'role'];

const NO_PASS: FilterResult = { pass: false, jobIds: [], reason: null };

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1).toLowerCase();
}

// Whole words or phrases, so "role" doesn't match "control".
function hasPhrase(text: string, phrases: string[]): boolean {
  const plain = ` ${words(text).join(' ')} `;
  return phrases.some((p) => plain.includes(` ${words(p).join(' ')} `));
}

function newestFirst(jobs: FilterJob[]): number[] {
  return [...jobs]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
    .slice(0, MAX_JOBS)
    .map((j) => j.id);
}

function names(job: FilterJob): string[] {
  return [job.company, job.agency].filter((n): n is string => !!n?.trim());
}

export function firstFilter(msg: { from: string; subject: string; text: string }, jobs: FilterJob[], o: { ownAddress: string }): FilterResult {
  const from = msg.from.trim().toLowerCase();
  if (!from || from === o.ownAddress.trim().toLowerCase()) return NO_PASS;

  // 1. From one of your contacts.
  const byContact = jobs.filter((j) => j.contactEmails.some((e) => e.trim().toLowerCase() === from));
  if (byContact.length > 0) return { pass: true, jobIds: newestFirst(byContact), reason: 'contact' };

  // 2. From the company's, agency's or a contact's own domain.
  const domain = domainOf(from);
  if (!FREE_MAIL.has(domain)) {
    const labels = domain.split('.').filter((l) => !NOISE_LABELS.has(l));
    const byDomain = jobs.filter(
      (j) =>
        j.contactEmails.some((e) => domainOf(e) === domain) ||
        names(j).some((name) => {
          const compact = compactCompany(name);
          const first = normaliseCompany(name).split(' ')[0] ?? '';
          return labels.some((l) => (compact.length >= 4 && l === compact) || (first.length >= 4 && l === first));
        }),
    );
    if (byDomain.length > 0) return { pass: true, jobIds: newestFirst(byDomain), reason: 'domain' };
  }

  // 3. The company or agency is named: in the subject, or in the text next to a job word.
  const text = msg.text.slice(0, TEXT_LIMIT);
  const jobWordInText = hasPhrase(text, BROAD);
  const byName = jobs.filter((j) =>
    names(j).some((name) => {
      const normal = normaliseCompany(name);
      if (normal.replace(/ /g, '').length < 3) return false;
      return hasPhrase(msg.subject, [normal]) || (jobWordInText && hasPhrase(text, [normal]));
    }),
  );
  if (byName.length > 0) return { pass: true, jobIds: newestFirst(byName), reason: 'name' };

  // 4. An email about an application, from anyone.
  if (hasPhrase(msg.subject, STRONG) || hasPhrase(text, STRONG)) return { pass: true, jobIds: [], reason: 'keyword' };
  return NO_PASS;
}
