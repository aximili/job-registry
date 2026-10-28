// Any other site, from the toolbar popup ("Save this page"): the page's
// JobPosting data first, then the text you've selected, then the page's main
// readable text (Mozilla Readability, the same as Firefox's Reader View).

import { Readability } from '@mozilla/readability';
import { canonicalJobUrl } from '../../../shared/canonical-url.ts';
import type { Capture } from '../../../shared/contracts/index.ts';
import { readJobPosting } from '../jsonld.ts';
import { elementText, htmlToText, tidyText } from '../text.ts';
import { firstText, type SiteExtractor } from './helpers.ts';

const SELECTION_MIN = 200;

export const generic: SiteExtractor = {
  id: 'generic',
  matches: () => true,
  currentJobId: () => null,
  extract(doc, url, now) {
    const canonical = canonicalJobUrl(url.href);
    const base = {
      sourceUrl: url.href,
      canonicalUrl: canonical.canonicalUrl,
      sourceSite: canonical.sourceSite,
      externalId: canonical.externalId,
      capturedAt: now.toISOString(),
    };
    const posting = readJobPosting(doc);
    const selection = tidyText(doc.getSelection?.()?.toString() ?? '');
    const heading = firstText(doc, ['main h1', 'article h1', 'h1']);

    if (posting?.descriptionHtml && selection.length < SELECTION_MIN) {
      const s = posting.structured;
      return {
        ...base,
        ...(s.title ? { title: s.title } : {}),
        ...(s.company ? { company: s.company } : {}),
        ...(s.location ? { location: s.location } : {}),
        jdText: htmlToText(posting.descriptionHtml, doc),
        structured: s,
      } satisfies Capture;
    }
    if (selection.length >= SELECTION_MIN) {
      return { ...base, ...(heading ? { title: heading } : {}), jdText: selection };
    }
    // Readability changes the document it reads, so it gets a copy.
    let article: { title?: string | null; content?: string | null } | null = null;
    try {
      article = new Readability(doc.cloneNode(true) as Document).parse();
    } catch {
      article = null;
    }
    const text = article?.content ? htmlToText(article.content, doc) : elementText(doc.body);
    if (!text) return null;
    const title = heading ?? article?.title?.trim() ?? doc.title.trim();
    return { ...base, ...(title ? { title } : {}), jdText: text };
  },
};
