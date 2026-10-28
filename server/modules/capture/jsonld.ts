// Reads schema.org JobPosting data from a downloaded page's HTML, for a
// pasted link. The mapping itself lives in shared/jobposting.ts.

import type { ParsedJob } from '../../../shared/contracts/index.ts';
import { mapJobPosting } from '../../../shared/jobposting.ts';
import { htmlFragmentToText } from './text.ts';

const LD_SCRIPT = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export function extractJobPosting(html: string): { structured: Partial<ParsedJob>; descriptionText: string | null } | null {
  for (const match of html.matchAll(LD_SCRIPT)) {
    let data: unknown;
    try {
      data = JSON.parse(match[1] ?? '');
    } catch {
      continue;
    }
    const mapped = mapJobPosting(data);
    if (mapped) {
      return { structured: mapped.structured, descriptionText: mapped.descriptionHtml ? htmlFragmentToText(mapped.descriptionHtml) : null };
    }
  }
  return null;
}
