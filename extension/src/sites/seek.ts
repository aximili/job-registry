// Seek (seek.com.au, seek.co.nz): job pages (/job/123) and search pages with
// a job open in the right-hand pane (?jobId=123).

import { firstElement, firstText, linkedJobId, paneOf, siteCapture, type SiteExtractor } from './helpers.ts';

const DETAILS = ['[data-automation="splitViewJobDetailsWrapper"]', '[data-automation="jobDetailsPage"]'];

export const seek: SiteExtractor = {
  id: 'seek',
  matches: (url) => /(^|\.)seek\.(com\.au|co\.nz)$/.test(url.hostname),
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
      jobUrl: `https://${url.hostname.replace(/^(?!www\.)/, 'www.')}/job/${id}`,
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
};
