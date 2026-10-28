// The page's own JobPosting data, if it has any (schema.org JSON-LD).

import { mapJobPosting, type MappedJobPosting } from '../../shared/jobposting.ts';

export function readJobPosting(doc: Document): MappedJobPosting | null {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    const mapped = mapJobPosting(data);
    if (mapped) return mapped;
  }
  return null;
}
