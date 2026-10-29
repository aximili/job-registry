// Indeed (au.indeed.com and others): job pages (/viewjob?jk=…), search pages
// with a job open on the right (?vjk=…), and the job cards in a search list.

import { cardsIn, firstElement, firstText, foundCard, paneOf, siteCapture, squash, textsOf, type SiteExtractor } from './helpers.ts';

const JOB_KEY = /^[0-9a-f]{16}$/i;
const DETAILS = ['#jobsearch-ViewjobPaneWrapper', '.jobsearch-ViewJobLayout', '.jobsearch-JobComponent'];

const jobUrl = (url: URL, jk: string) => `${url.origin}/viewjob?jk=${jk}`;

export const indeed: SiteExtractor = {
  id: 'indeed',
  matches: (url) => url.hostname === 'indeed.com' || url.hostname.endsWith('.indeed.com'),
  currentJobId(url) {
    const id = [url.searchParams.get('jk'), url.searchParams.get('vjk')].find((v): v is string => v !== null && JOB_KEY.test(v));
    return id ? id.toLowerCase() : null;
  },
  extract(doc, url, now) {
    const id = indeed.currentJobId(url, doc);
    if (!id) return null;
    const pane = paneOf(doc, DETAILS);
    // Indeed adds a hidden " - job post" to the title for screen readers.
    const title = firstText(pane, ['[data-testid="jobsearch-JobInfoHeader-title"]', '.jobsearch-JobInfoHeader-title'])?.replace(/\s*-\s*job post$/i, '');
    return siteCapture({
      url,
      jobUrl: jobUrl(url, id),
      doc,
      now,
      title: title || undefined,
      company: firstText(pane, ['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]']),
      location: firstText(pane, ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]']),
      facts: [firstText(pane, ['#salaryInfoAndJobType'])],
      description: firstElement(pane, ['#jobDescriptionText']),
      jobId: id,
      paneJobId: null,
    });
  },
  readCards(doc, url) {
    return cardsIn(doc, '.job_seen_beacon', (card) => {
      // A sponsored card's link has no job key, so it's skipped.
      const link = card.querySelector('a.jcs-JobTitle');
      const jk = link?.getAttribute('data-jk');
      return foundCard({
        element: card,
        titleEl: link,
        // The title's own span, not the "new" label next to it.
        title: squash(card.querySelector('h2.jobTitle span[title]')?.getAttribute('title')) || firstText(card, ['h2.jobTitle']),
        jobUrl: jk ? jobUrl(url, jk) : null,
        company: firstText(card, ['[data-testid="company-name"]']),
        location: firstText(card, ['[data-testid="text-location"]']),
        // Not when it was posted (data-testid="myJobsStateDate"): it changes every day.
        parts: [
          ...textsOf(card, '[data-testid="attribute_snippet_testid"], .salary-snippet-container'),
          ...textsOf(card, '[data-testid="jobsnippet_footer"] li, .job-snippet li'),
        ],
      });
    });
  },
};
