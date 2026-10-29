// Seek (au.seek.com and nz.seek.com, and the older seek.com.au and
// seek.co.nz): job pages (/job/123), search pages with a job open in the
// right-hand pane (?jobId=123), and the job cards in a search list.

import { cardsIn, firstElement, firstText, foundCard, linkedJobId, paneOf, siteCapture, squash, textsOf, type SiteExtractor } from './helpers.ts';

const DETAILS = ['[data-automation="splitViewJobDetailsWrapper"]', '[data-automation="jobDetailsPage"]'];
const CARDS = 'article[data-automation="normalJob"], article[data-card-type="JobCard"]';

// The job's own page, on the address you're on. The stable link comes from it.
const jobUrl = (url: URL, id: string) => `${url.origin}/job/${id}`;

// "Melbourne VIC (Hybrid)": the places, then the work arrangement Seek shows
// just after them, as on the job's own page.
function cardLocation(card: Element): string | undefined {
  const places = textsOf(card, '[data-automation="jobLocation"]').join(', ');
  const after = squash(card.querySelector('[data-automation="jobCardLocation"]')?.nextElementSibling?.textContent);
  return [places, /^\(.+\)$/.test(after) ? after : ''].filter(Boolean).join(' ') || undefined;
}

export const seek: SiteExtractor = {
  id: 'seek',
  matches: (url) => /(^|\.)seek\.(com\.au|co\.nz)$|^(au|nz)\.seek\.com$/.test(url.hostname),
  currentJobId(url) {
    const fromPath = url.pathname.match(/^\/job\/(\d+)/)?.[1];
    const fromQuery = url.searchParams.get('jobId');
    return fromPath ?? (fromQuery && /^\d+$/.test(fromQuery) ? fromQuery : null);
  },
  extract(doc, url, now) {
    const id = seek.currentJobId(url, doc);
    if (!id) return null;
    const pane = paneOf(doc, DETAILS);
    // A bare <h1> is the job's title only on the job's own page; on a search
    // page it's the page's heading.
    const ownPage = url.pathname.startsWith('/job/');
    return siteCapture({
      url,
      jobUrl: jobUrl(url, id),
      doc,
      now,
      title: firstText(pane, ownPage ? ['[data-automation="job-detail-title"]', 'h1'] : ['[data-automation="job-detail-title"]']),
      company: firstText(pane, ['[data-automation="advertiser-name"]']),
      location: firstText(pane, ['[data-automation="job-detail-location"]']),
      facts: [
        firstText(pane, ['[data-automation="job-detail-work-type"]']),
        firstText(pane, ['[data-automation="job-detail-salary"]']),
      ],
      description: firstElement(pane, ['[data-automation="jobAdDetails"]']),
      jobId: id,
      paneJobId: linkedJobId(pane, /^\/job\/(\d+)/),
    });
  },
  readCards(doc, url) {
    return cardsIn(doc, CARDS, (card) => {
      const id = card.getAttribute('data-job-id');
      return foundCard({
        element: card,
        titleEl: card.querySelector('a[data-automation="jobTitle"]'),
        title: firstText(card, ['a[data-automation="jobTitle"]']),
        jobUrl: id ? jobUrl(url, id) : null,
        company: firstText(card, ['[data-automation="jobCompany"]']),
        location: cardLocation(card),
        // Not the listing date (data-automation="jobListingDate", and the
        // hidden "Listed 7 hours ago"): it changes every day.
        parts: [
          // The work type is only in a sentence for screen readers.
          ...textsOf(card, 'p').filter((t) => /^This is an? .+ job$/i.test(t)),
          ...textsOf(card, '[data-automation="jobSalary"]'),
          ...textsOf(card, 'ul li'),
          ...textsOf(card, '[data-automation="jobShortDescription"]'),
          textsOf(card, '[data-automation="jobSubClassification"], [data-automation="jobClassification"]').join(' '),
        ],
      });
    });
  },
};
