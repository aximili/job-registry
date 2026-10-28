// What every site extractor shares: finding things on the page, and turning
// what it found into a Capture the server understands.

import { canonicalJobUrl } from '../../../shared/canonical-url.ts';
import type { Capture, ParsedJob } from '../../../shared/contracts/index.ts';
import { readJobPosting } from '../jsonld.ts';
import { elementText, htmlToText } from '../text.ts';

export interface SiteExtractor {
  id: 'seek' | 'linkedin' | 'indeed' | 'generic';
  matches(url: URL): boolean;
  // The job on screen: the page's own job, or the one open in a split view.
  currentJobId(url: URL, doc: Document): string | null;
  // null while the job's details haven't appeared yet.
  extract(doc: Document, url: URL, now: Date): Capture | null;
}

export function firstElement(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el && el.textContent?.trim()) return el;
  }
  return null;
}

// The part of the page that shows the job: the first of these that exists,
// even if it's still empty, so an empty pane is never mistaken for the page.
export function paneOf(doc: Document, selectors: string[]): ParentNode {
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (el) return el;
  }
  return doc;
}

// The job id that the pane's own links point to, if it has any.
export function linkedJobId(pane: ParentNode, pattern: RegExp): string | null {
  for (const a of Array.from(pane.querySelectorAll('a[href]'))) {
    const id = (a.getAttribute('href') ?? '').match(pattern)?.[1];
    if (id) return id.toLowerCase();
  }
  return null;
}

export function firstText(root: ParentNode, selectors: string[]): string | undefined {
  const text = firstElement(root, selectors)?.textContent?.replace(/\s+/g, ' ').trim();
  return text || undefined;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// For the three job sites: the facts at the top of the ad (title, company,
// location, work type, salary) go above the description in the saved ad
// text. Sites often show the salary only there, and the AI reads the ad text.
export function siteCapture(opts: {
  url: URL;
  jobUrl: string;
  doc: Document;
  now: Date;
  title?: string;
  company?: string;
  location?: string;
  facts: (string | undefined)[];
  description: Element | null;
  // The job the pane itself shows (from its links), when it says.
  jobId: string;
  paneJobId: string | null;
}): Capture | null {
  // A split pane still showing another job is still loading.
  if (opts.paneJobId !== null && opts.paneJobId !== opts.jobId.toLowerCase()) return null;
  // Without the ad's text, it isn't read yet: a title alone is never saved.
  const description = elementText(opts.description);
  if (!description) return null;
  const header = [opts.title, opts.company, opts.location, ...opts.facts].filter((f): f is string => !!f);
  const jdText = [header.join('\n'), description].filter(Boolean).join('\n\n');
  const canonical = canonicalJobUrl(opts.jobUrl);
  // The page's own JobPosting data, only if it's about this job: a site that
  // changes jobs without reloading may still hold the first job's data.
  const posting = readJobPosting(opts.doc);
  const structured = posting && (!opts.title || same(posting.structured.title, opts.title)) ? posting.structured : undefined;
  return {
    sourceUrl: opts.url.href,
    canonicalUrl: canonical.canonicalUrl,
    sourceSite: canonical.sourceSite,
    externalId: canonical.externalId,
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.company ? { company: opts.company } : {}),
    ...(opts.location ? { location: opts.location } : {}),
    jdText,
    ...(structured && Object.keys(structured).length > 0 ? { structured: structured as Partial<ParsedJob> } : {}),
    capturedAt: opts.now.toISOString(),
  };
}

export { htmlToText };
