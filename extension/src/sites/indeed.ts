// Indeed (au.indeed.com and others): job pages (/viewjob?jk=…) and search
// pages with a job open on the right (?vjk=…).

import { firstElement, firstText, paneOf, siteCapture, type SiteExtractor } from './helpers.ts';

const JOB_KEY = /^[0-9a-f]{16}$/i;
const DETAILS = ['#jobsearch-ViewjobPaneWrapper', '.jobsearch-ViewJobLayout', '.jobsearch-JobComponent'];

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
      jobUrl: `https://${url.hostname}/viewjob?jk=${id}`,
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
};
