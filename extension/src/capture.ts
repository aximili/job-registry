// When a site's own reader finds nothing, you can still save the job: the
// text you selected, or the page's main readable text. The job keeps the
// site's link and id, so it's still recognised next time.

import { canonicalJobUrl } from '../../shared/canonical-url.ts';
import type { Capture } from '../../shared/contracts/index.ts';
import { generic } from './sites/index.ts';
import { tidyText } from './text.ts';

// Only on the job's own page is the page's heading the job's title. On a
// search page it's the search ("Software Engineer jobs in Sydney"), and a
// title saved from the page is one the AI would never replace.
const OWN_JOB_PAGE = /^\/(job\/\d+|(comm\/)?jobs\/view\/|viewjob)/;

export function fallbackCapture(doc: Document, url: URL, now: Date, from: 'selection' | 'page'): Capture | null {
  const canonical = canonicalJobUrl(url.href);
  const base = generic.extract(doc, url, now);
  const title = OWN_JOB_PAGE.test(url.pathname) ? base?.title : undefined;
  const selected = tidyText(doc.getSelection?.()?.toString() ?? '');
  const jdText = from === 'selection' ? selected : base?.jdText ?? '';
  if (!jdText) return null;
  return {
    sourceUrl: url.href,
    canonicalUrl: canonical.canonicalUrl,
    sourceSite: canonical.sourceSite,
    externalId: canonical.externalId,
    ...(title ? { title } : {}),
    jdText,
    capturedAt: now.toISOString(),
  };
}
