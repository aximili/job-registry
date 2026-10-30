// Seek (au.seek.com and nz.seek.com, and the older seek.com.au and
// seek.co.nz): job pages (/job/123), search pages with a job open in the
// right-hand pane (?jobId=123), the home page with a job open in its
// pop-over, and the job cards in a search list and in the home page's
// Recommended list.

import { cardsIn, firstElement, firstText, foundCard, linkedJobId, paneOf, siteCapture, squash, textsOf, type SiteExtractor } from './helpers.ts';

// The pop-over a Recommended card opens on the home page. The address stays
// the same, so the job comes from the pop-over's own links.
const DRAWER = '#homepageDrawer';
const DETAILS = ['[data-automation="splitViewJobDetailsWrapper"]', '[data-automation="jobDetailsPage"]', DRAWER];
// A link to a job: "/job/123" on the page, the full address in a saved copy.
const JOB_LINK = /^(?:https?:\/\/[^/]+)?\/job\/(\d+)/;
const CARDS = 'article[data-automation="normalJob"], article[data-card-type="JobCard"]';
// The Recommended list on the home page you see when signed in.
const FEED_CARDS = 'ul[data-automation="feedJobs"] > li';

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
  currentJobId(url, doc) {
    const fromPath = url.pathname.match(/^\/job\/(\d+)/)?.[1];
    if (fromPath) return fromPath;
    const fromQuery = url.searchParams.get('jobId');
    if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;
    const drawer = doc.querySelector(DRAWER);
    return drawer ? linkedJobId(drawer, JOB_LINK) : null;
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
    return cardsIn(doc, `${CARDS}, ${FEED_CARDS}`, (card) => (card.matches(FEED_CARDS) ? feedCard(card, url) : searchCard(card, url)));
  },
};

function searchCard(card: Element, url: URL) {
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
}

// A Recommended card: the work type, the place and the salary (if any) are
// plain text just below the title and company, in that order, under any
// badges ("Expiring soon"). Not the badges, "1d ago" or "Viewed": they change.
function feedCard(card: Element, url: URL) {
  const id = card.querySelector('a[data-automation^="recommendedJobLink_"]')?.getAttribute('href')?.match(JOB_LINK)?.[1];
  const titleEl = card.querySelector('[data-automation="jobTitle"]');
  const rows = Array.from(titleEl?.closest('h3')?.parentElement?.nextElementSibling?.children ?? []);
  const facts = rows.find((row) => row.firstElementChild?.tagName === 'SPAN' && !row.querySelector('[data-automation]'));
  const [workType, place, ...rest] = Array.from(facts?.children ?? []);
  return foundCard({
    element: card,
    titleEl,
    title: firstText(card, ['[data-automation="jobTitle"]']),
    jobUrl: id ? jobUrl(url, id) : null,
    company: firstText(card, ['[data-automation="jobAdvertiser"]']),
    // "Melbourne VIC" and "(Remote)" sit in separate spans.
    location: place ? Array.from(place.childNodes, (n) => squash(n.textContent)).filter(Boolean).join(' ') || undefined : undefined,
    parts: [squash(workType?.textContent), ...rest.map((el) => squash(el.textContent)), ...textsOf(card, 'ul li')],
  });
}
