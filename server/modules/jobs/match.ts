// "Is this the same role as one I've already saved?" This is plain code, not AI,
// so it answers instantly and the same way every time. See decision 0010.

import { normaliseCompany, words } from '../../../shared/company.ts';
import type { Candidate, SourceSite } from '../../../shared/contracts/index.ts';

export type MatchableJob = {
  id: number;
  title: string | null;
  company: string | null;
  agency: string | null;
  location: string | null;
  status: string;
  dateApplied: string | null;
  createdAt: string;
  sourceSites: SourceSite[];
};

const LIKELY = 0.6;
const POSSIBLE = 0.8;
const MAX_CANDIDATES = 3;

const TITLE_EXPANSIONS: Record<string, string> = {
  sr: 'senior',
  snr: 'senior',
  jr: 'junior',
  mgr: 'manager',
  eng: 'engineer',
  dev: 'developer',
};

const TITLE_NOISE = new Set([
  'a', 'an', 'the', 'of', 'and', 'at', 'for', 'in', 'to', 'with',
  'remote', 'hybrid', 'contract', 'permanent', 'full', 'part', 'time', 'fte',
]);

export function titleTokens(title: string): Set<string> {
  return new Set(words(title).map((w) => TITLE_EXPANSIONS[w] ?? w).filter((w) => !TITLE_NOISE.has(w)));
}

// Share of words the two titles have in common (Jaccard index), from 0 to 1.
export function titleSimilarity(a: string, b: string): number {
  const left = titleTokens(a);
  const right = titleTokens(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / union.size;
}

function city(location: string | null | undefined): string | null {
  return location ? (words(location)[0] ?? null) : null;
}

export function findCandidates(
  input: { title?: string; company?: string; location?: string },
  jobs: MatchableJob[],
): Candidate[] {
  if (!input.title) return [];
  const company = input.company ? normaliseCompany(input.company) : null;
  const inputCity = city(input.location);

  const matches: { job: MatchableJob; similarity: number; strength: Candidate['strength'] }[] = [];
  for (const job of jobs) {
    if (!job.title) continue;
    const similarity = titleSimilarity(input.title, job.title);
    const jobCompany = job.company ? normaliseCompany(job.company) : null;
    const jobAgency = job.agency ? normaliseCompany(job.agency) : null;
    const jobCity = city(job.location);

    if (company && jobCompany && company === jobCompany && similarity >= LIKELY) {
      matches.push({ job, similarity, strength: 'likely' });
      continue;
    }
    // Agency ads often hide the employer: match on title and city instead,
    // but never when both sides name different real employers.
    const citiesFit = !inputCity || !jobCity || inputCity === jobCity;
    const companiesFit = !company || !jobCompany || company === jobAgency;
    if (similarity >= POSSIBLE && citiesFit && companiesFit) matches.push({ job, similarity, strength: 'possible' });
  }

  matches.sort(
    (a, b) =>
      Number(b.strength === 'likely') - Number(a.strength === 'likely') ||
      b.similarity - a.similarity ||
      b.job.createdAt.localeCompare(a.job.createdAt),
  );

  return matches.slice(0, MAX_CANDIDATES).map(({ job, strength }) => ({
    jobId: job.id,
    title: job.title,
    company: job.company,
    status: job.status,
    dateApplied: job.dateApplied,
    agency: job.agency,
    location: job.location,
    sourceSites: job.sourceSites,
    strength,
  }));
}
