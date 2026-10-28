// LinkedIn: job pages (/jobs/view/123) and search pages with a job open on the
// right (?currentJobId=123). Signed-in pages and signed-out (guest) pages use
// different class names, so both are listed.

import { firstElement, firstText, linkedJobId, paneOf, siteCapture, type SiteExtractor } from './helpers.ts';

const DETAILS = ['.jobs-search__job-details--container', '.scaffold-layout__detail', '.job-view-layout', 'main'];

export const linkedin: SiteExtractor = {
  id: 'linkedin',
  matches: (url) => url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com'),
  currentJobId(url) {
    const fromPath = url.pathname.match(/^\/(?:comm\/)?jobs\/view\/(?:[^/]*-)?(\d+)\/?$/)?.[1];
    const fromQuery = url.searchParams.get('currentJobId');
    return fromPath ?? (fromQuery && /^\d+$/.test(fromQuery) ? fromQuery : null);
  },
  extract(doc, url, now) {
    const id = linkedin.currentJobId(url, doc);
    if (!id) return null;
    const pane = paneOf(doc, DETAILS);
    return siteCapture({
      url,
      jobUrl: `https://www.linkedin.com/jobs/view/${id}/`,
      doc,
      now,
      title: firstText(pane, [
        '.job-details-jobs-unified-top-card__job-title h1',
        '.job-details-jobs-unified-top-card__job-title',
        '.jobs-unified-top-card__job-title',
        '.top-card-layout__title',
      ]),
      company: firstText(pane, [
        '.job-details-jobs-unified-top-card__company-name',
        '.jobs-unified-top-card__company-name',
        '.topcard__org-name-link',
      ]),
      location: firstText(pane, [
        '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
        '.job-details-jobs-unified-top-card__bullet',
        '.topcard__flavor--bullet',
      ]),
      facts: [firstText(pane, ['.job-details-fit-level-preferences', '.job-details-jobs-unified-top-card__job-insight'])],
      description: firstElement(pane, ['#job-details', '.jobs-description__content', '.jobs-box__html-content', '.show-more-less-html__markup']),
      jobId: id,
      // The title links to its own job; other links in the pane may not.
      paneJobId: linkedJobId(firstElement(pane, ['.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title']) ?? doc.createElement('div'), /\/jobs\/view\/(?:[^/]*-)?(\d+)/),
    });
  },
};
