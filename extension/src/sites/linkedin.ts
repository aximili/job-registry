// LinkedIn: job pages (/jobs/view/123), search pages with a job open on the
// right (?currentJobId=123), and the job cards in a search list. Signed-in
// pages and signed-out (guest) pages use different class names, so both are
// listed.

import { cardsIn, firstElement, firstText, foundCard, linkedJobId, paneOf, siteCapture, squash, textsOf, type FoundCard, type SiteExtractor } from './helpers.ts';

const DETAILS = ['.jobs-search__job-details--container', '.scaffold-layout__detail', '.job-view-layout', 'main'];
// Signed in: a list item for each job, which LinkedIn fills in as you scroll,
// and the card inside it. Signed out: .base-card.
const CARDS = 'li[data-occludable-job-id], .job-card-container[data-job-id], .base-card';

const jobUrl = (id: string) => `https://www.linkedin.com/jobs/view/${id}/`;

// LinkedIn's cards have no teaser, and the footer only says "Promoted",
// "Viewed", "Easy Apply" or when the job was listed, so only the salary line
// goes into the card's text.
function signedInCard(card: Element): FoundCard | null {
  const link = firstElement(card, ['a.job-card-list__title--link', 'a.job-card-container__link']);
  const id = card.getAttribute('data-occludable-job-id') ?? card.getAttribute('data-job-id');
  return foundCard({
    element: card,
    titleEl: link,
    // The visible title, not the copy LinkedIn adds for screen readers.
    title: squash(link?.querySelector('strong')?.textContent) || squash(link?.getAttribute('aria-label')) || squash(link?.textContent) || undefined,
    jobUrl: id ? jobUrl(id) : null,
    company: firstText(card, ['.artdeco-entity-lockup__subtitle']),
    location: firstText(card, ['.artdeco-entity-lockup__caption']),
    parts: textsOf(card, '.artdeco-entity-lockup__metadata li'),
  });
}

// The whole card is one link; the title is a heading of its own.
function guestCard(card: Element): FoundCard | null {
  const id = card.getAttribute('data-entity-urn')?.match(/^urn:li:jobPosting:(\d+)$/)?.[1];
  return foundCard({
    element: card,
    titleEl: card.querySelector('.base-search-card__title'),
    title: firstText(card, ['.base-search-card__title']),
    jobUrl: id ? jobUrl(id) : null,
    company: firstText(card, ['.base-search-card__subtitle']),
    location: firstText(card, ['.job-search-card__location']),
    // Not the listing date (<time>): it changes every day.
    parts: textsOf(card, '.job-search-card__salary-info'),
  });
}

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
      jobUrl: jobUrl(id),
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
  readCards(doc) {
    return cardsIn(doc, CARDS, (card) => (card.matches('.base-card') ? guestCard(card) : signedInCard(card)));
  },
};
