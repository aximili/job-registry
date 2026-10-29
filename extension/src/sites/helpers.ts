// What every site extractor shares: finding things on the page, and turning
// what it found into a Capture (a job) or a JobCard (a card in a search list)
// the server understands.

import { canonicalJobUrl } from '../../../shared/canonical-url.ts';
import type { Capture, JobCard, ParsedJob } from '../../../shared/contracts/index.ts';
import { readJobPosting } from '../jsonld.ts';
import { elementText, htmlToText } from '../text.ts';

// A job card in a search list: the card itself, the element its mark goes
// right after, and what the card says.
export type FoundCard = { element: Element; anchor: Element; card: JobCard };

export interface SiteExtractor {
  id: 'seek' | 'linkedin' | 'indeed' | 'generic';
  matches(url: URL): boolean;
  // The job on screen: the page's own job, or the one open in a split view.
  currentJobId(url: URL, doc: Document): string | null;
  // null while the job's details haven't appeared yet.
  extract(doc: Document, url: URL, now: Date): Capture | null;
  // The job cards in a search list, in page order. [] on other pages.
  readCards(doc: Document, url: URL): FoundCard[];
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

// Text on one line: each run of spaces and line breaks becomes one space.
export function squash(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function firstText(root: ParentNode, selectors: string[]): string | undefined {
  return squash(firstElement(root, selectors)?.textContent) || undefined;
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

const CARD_TEXT_MAX = 4000;
const CARD_FIELD_MAX = 300;
// Never part of a card's text: buttons ("Save", "Easy Apply") and dates.
const NOT_CARD_TEXT = new Set(['BUTTON', 'TIME', 'SCRIPT', 'STYLE', 'SVG', 'TEMPLATE']);

function shownText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1 || NOT_CARD_TEXT.has((node as Element).tagName.toUpperCase())) return '';
  return Array.from(node.childNodes, shownText).join('');
}

// The text of each element that matches, in page order, without buttons or dates.
export function textsOf(root: ParentNode, selector: string): string[] {
  return Array.from(root.querySelectorAll(selector), (el) => squash(shownText(el))).filter(Boolean);
}

// One job card, ready for its mark. null for a card with no job link the app
// can read (an advert, a banner) or no title yet.
export function foundCard(opts: {
  element: Element;
  // The title link (or the title itself). The mark goes after its heading.
  titleEl: Element | null;
  title: string | undefined;
  // The job's link, built the same way as the job page reader builds it, so
  // the card and the job share one stable link.
  jobUrl: string | null;
  company: string | undefined;
  location: string | undefined;
  // What else the card shows, one line each: salary, work type, the teaser.
  parts: string[];
}): FoundCard | null {
  const { element, titleEl, title, jobUrl } = opts;
  if (!titleEl || !title || !jobUrl) return null;
  let canonical: ReturnType<typeof canonicalJobUrl>;
  try {
    canonical = canonicalJobUrl(jobUrl);
  } catch {
    return null;
  }
  if (!canonical.externalId) return null;
  // Each line once, and not the title, company or location again.
  const seen = new Set([title, opts.company, opts.location].filter((f): f is string => !!f).map((f) => f.toLowerCase()));
  const lines: string[] = [];
  for (const part of opts.parts) {
    if (!part || seen.has(part.toLowerCase())) continue;
    seen.add(part.toLowerCase());
    lines.push(part);
  }
  const heading = titleEl.closest('h1, h2, h3, h4');
  return {
    element,
    anchor: heading && element.contains(heading) ? heading : titleEl,
    card: {
      canonicalUrl: canonical.canonicalUrl,
      sourceSite: canonical.sourceSite,
      externalId: canonical.externalId,
      title: title.slice(0, CARD_FIELD_MAX),
      company: opts.company?.slice(0, CARD_FIELD_MAX) ?? null,
      location: opts.location?.slice(0, CARD_FIELD_MAX) ?? null,
      text: lines.join('\n').slice(0, CARD_TEXT_MAX),
    },
  };
}

// The cards that match, in page order, each job once: a site can draw the
// same job twice (LinkedIn's list item and the card inside it), and the
// first one wins.
export function cardsIn(doc: Document, selector: string, read: (el: Element) => FoundCard | null): FoundCard[] {
  const seen = new Set<string>();
  const cards: FoundCard[] = [];
  for (const el of Array.from(doc.querySelectorAll(selector))) {
    const found = read(el);
    if (!found || seen.has(found.card.canonicalUrl)) continue;
    seen.add(found.card.canonicalUrl);
    cards.push(found);
  }
  return cards;
}

export { htmlToText };
