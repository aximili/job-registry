import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { pickExtractor } from './index.ts';

const now = new Date('2026-10-28T03:15:00.000Z');

function page(file: string, href: string, opts: { selection?: string } = {}) {
  const html = readFileSync(new URL(`../../../tests/fixtures/sites/${file}`, import.meta.url), 'utf8');
  const { document, window } = parseHTML(html);
  if (opts.selection !== undefined) {
    (document as unknown as { getSelection: () => { toString: () => string } }).getSelection = () => ({ toString: () => opts.selection! });
  }
  void window;
  const url = new URL(href);
  const extractor = pickExtractor(url);
  return { extractor, doc: document as unknown as Document, url, capture: extractor.extract(document as unknown as Document, url, now) };
}

// The job cards a reader finds on a search list.
function cardsOn(file: string, href: string) {
  const { extractor, doc, url } = page(file, href);
  return extractor.readCards(doc, url);
}

// A line of a card's text that is the title, company or location again.
function repeats(found: { card: { title: string; company: string | null; location: string | null; text: string } }): string[] {
  const { title, company, location, text } = found.card;
  const fields = [title, company, location].filter((f): f is string => !!f).map((f) => f.toLowerCase());
  return text.split('\n').filter((line) => fields.includes(line.toLowerCase()));
}

describe('Seek', () => {
  it('reads a job page', () => {
    const { extractor, capture } = page('seek-job.html', 'https://www.seek.com.au/job/81234567?type=standard&ref=search');
    expect(extractor.id).toBe('seek');
    expect(capture).toMatchObject({
      title: 'Senior Software Engineer',
      company: 'Atlassian',
      location: 'Sydney NSW',
      canonicalUrl: 'https://www.seek.com.au/job/81234567',
      sourceSite: 'seek',
      externalId: '81234567',
      sourceUrl: 'https://www.seek.com.au/job/81234567?type=standard&ref=search',
      capturedAt: '2026-10-28T03:15:00.000Z',
    });
    expect(capture!.jdText).toContain('• Design and build services in TypeScript and Java');
    expect(capture!.jdText).toContain('Applications close 19 November 2026.');
    expect(capture!.jdText).not.toContain('Short version for search engines');
    // The page's own data still comes along, for fields the page shows nowhere else.
    expect(capture!.structured).toMatchObject({ employmentType: 'full-time', closingDate: '2026-11-19' });
  });

  it('reads a real job page at au.seek.com', () => {
    const { extractor, capture } = page('seek-job-real.html', 'https://au.seek.com/job/95339378?type=standard');
    expect(extractor.id).toBe('seek');
    expect(capture).toMatchObject({
      title: 'Senior Full Stack Developer',
      company: 'City Of Casey',
      location: 'Narre Warren, Melbourne VIC (Hybrid)',
      canonicalUrl: 'https://www.seek.com.au/job/95339378',
      sourceSite: 'seek',
      externalId: '95339378',
      sourceUrl: 'https://au.seek.com/job/95339378?type=standard',
    });
    // The header facts come first, because the salary is often only there.
    expect(capture!.jdText).toContain('Base $115,289 - $129,007 + Super | Hybrid');
    expect(capture!.jdText).toContain('follow us on LinkedIn.');
  });

  it('reads the right-hand pane of a search page at au.seek.com', () => {
    const { extractor, doc, url, capture } = page('seek-search.html', 'https://au.seek.com/software-engineer-jobs/in-Sydney-NSW?jobId=81234568');
    expect(extractor.currentJobId(url, doc)).toBe('81234568');
    expect(capture).toMatchObject({ title: 'Platform Engineer', canonicalUrl: 'https://www.seek.com.au/job/81234568', externalId: '81234568' });
  });

  it("reads the right-hand pane of a search page, not the list's first card", () => {
    const { extractor, doc, url, capture } = page('seek-search.html', 'https://www.seek.com.au/software-engineer-jobs/in-Sydney-NSW?jobId=81234568&type=standard');
    expect(extractor.currentJobId(url, doc)).toBe('81234568');
    expect(capture).toMatchObject({ title: 'Platform Engineer', company: 'Canva', canonicalUrl: 'https://www.seek.com.au/job/81234568', externalId: '81234568' });
    expect(capture!.jdText).toContain('Kubernetes and Terraform');
  });

  it('a search page with no job open has nothing to read', () => {
    const { extractor, doc, url } = page('seek-search.html', 'https://www.seek.com.au/software-engineer-jobs');
    expect(extractor.currentJobId(url, doc)).toBeNull();
  });

  it('finds the job cards on a real search page at au.seek.com, in page order', () => {
    const found = cardsOn('seek-search-real.html', 'https://au.seek.com/full-stack-developer-jobs/in-All-Melbourne-VIC');
    expect(found.map((f) => f.card.externalId)).toEqual([
      '95571906', '95213158', '95082866', '95576249', '95446316', '95231749', '95308074', '94985582', '95518281', '95306518',
    ]);
    expect(found[0]!.card).toEqual({
      canonicalUrl: 'https://www.seek.com.au/job/95571906',
      sourceSite: 'seek',
      externalId: '95571906',
      title: 'Full-Stack Software Developer',
      company: 'Soniq Digital Media Pty Ltd',
      location: 'Richmond, Melbourne VIC',
      text: [
        'This is a Casual/Vacation job',
        '$75,000 – $100,000 per year',
        'Flexible casual role. Work on diverse projects with modern tech stack and innovative digital team.',
        'Developers/Programmers (Information & Communication Technology)',
      ].join('\n'),
    });
    for (const f of found) {
      expect(f.card.externalId).toMatch(/^\d{7,9}$/);
      expect(f.card.canonicalUrl).toBe(`https://www.seek.com.au/job/${f.card.externalId}`);
      expect(f.card.title).not.toBe('');
      expect(f.card.company).toBeTruthy();
      expect(repeats(f)).toEqual([]);
      // The mark goes after the title's heading, inside the card.
      expect(f.anchor.tagName).toBe('H3');
      expect(f.element.contains(f.anchor)).toBe(true);
    }
    expect(found.filter((f) => f.card.text.includes('$'))).toHaveLength(7);
    // The work arrangement Seek shows next to the place, as on the job's own page.
    expect(found[2]!.card.location).toBe('Northcote, Melbourne VIC (Hybrid)');
    // The teaser's bullet points, each on its own line.
    expect(found[2]!.card.text).toContain('Salary + Super\nJoin a purpose-driven organisation and develop innovative web solutions\nWork within a highly skilled marketing and communications team\n');
  });

  it('finds the cards on a hand-made search page, with the mark after the title link when there is no heading', () => {
    const found = cardsOn('seek-search.html', 'https://www.seek.com.au/software-engineer-jobs');
    expect(found.map((f) => f.card)).toEqual([
      { canonicalUrl: 'https://www.seek.com.au/job/81234567', sourceSite: 'seek', externalId: '81234567', title: 'Senior Software Engineer', company: 'Atlassian', location: 'Sydney NSW', text: '' },
      { canonicalUrl: 'https://www.seek.com.au/job/81234568', sourceSite: 'seek', externalId: '81234568', title: 'Platform Engineer', company: 'Canva', location: 'Surry Hills, Sydney NSW', text: '' },
    ]);
    for (const f of found) {
      expect(f.anchor.getAttribute('data-automation')).toBe('jobTitle');
      expect(f.element.contains(f.anchor)).toBe(true);
    }
  });
});

describe('LinkedIn', () => {
  it('reads a signed-in job page', () => {
    const { extractor, capture } = page('linkedin-job.html', 'https://www.linkedin.com/jobs/view/4012345678/?refId=abc');
    expect(extractor.id).toBe('linkedin');
    expect(capture).toMatchObject({
      title: 'Product Designer',
      company: 'Canva',
      location: 'Sydney, New South Wales, Australia',
      canonicalUrl: 'https://www.linkedin.com/jobs/view/4012345678/',
      externalId: '4012345678',
    });
    expect(capture!.jdText).toContain('• 4+ years designing digital products');
  });

  it('reads the open job on a search page (currentJobId)', () => {
    const { extractor, doc, url, capture } = page('linkedin-search.html', 'https://www.linkedin.com/jobs/search/?currentJobId=4012345679&keywords=designer');
    expect(extractor.currentJobId(url, doc)).toBe('4012345679');
    expect(capture).toMatchObject({ title: 'Senior UX Designer', company: 'Atlassian', externalId: '4012345679' });
  });

  it('reads a real signed-out job page', () => {
    const { capture } = page('linkedin-guest-job.html', 'https://www.linkedin.com/jobs/view/software-engineer-portfolio-engine-splunk-australia-at-cisco-4470914440');
    expect(capture).toMatchObject({
      title: 'Software Engineer, Portfolio Engine - Splunk, Australia',
      company: 'Cisco',
      location: 'Sydney, New South Wales, Australia',
      canonicalUrl: 'https://www.linkedin.com/jobs/view/4470914440/',
    });
    expect(capture!.jdText.length).toBeGreaterThan(1000);
  });

  it('finds the job cards on a signed-in search page, and skips a card LinkedIn has not filled in yet', () => {
    const found = cardsOn('linkedin-search.html', 'https://www.linkedin.com/jobs/search/?currentJobId=4012345679&keywords=designer');
    // Each job once, though both the list item and the card inside it carry its id.
    expect(found.map((f) => f.card)).toEqual([
      {
        canonicalUrl: 'https://www.linkedin.com/jobs/view/4012345678/',
        sourceSite: 'linkedin',
        externalId: '4012345678',
        // Not doubled: LinkedIn repeats the title in a visually hidden span.
        title: 'Product Designer',
        company: 'Canva',
        location: 'Sydney, New South Wales, Australia (Hybrid)',
        text: '',
      },
      {
        canonicalUrl: 'https://www.linkedin.com/jobs/view/4012345679/',
        sourceSite: 'linkedin',
        externalId: '4012345679',
        title: 'Senior UX Designer',
        company: 'Atlassian',
        location: 'Sydney, New South Wales, Australia (Remote)',
        // Not "Promoted", "Easy Apply", "Dismiss" or "Viewed".
        text: 'A$150K/yr - A$180K/yr',
      },
    ]);
    for (const f of found) {
      expect(f.element.tagName).toBe('LI');
      expect(f.anchor.matches('a.job-card-list__title--link')).toBe(true);
      expect(f.element.contains(f.anchor)).toBe(true);
    }
  });

  it('finds the job cards on a real signed-out search page', () => {
    const found = cardsOn('linkedin-guest-search.html', 'https://www.linkedin.com/jobs/search?keywords=Full%20Stack%20Developer');
    expect(found).toHaveLength(10);
    expect(found[0]!.card).toEqual({
      canonicalUrl: 'https://www.linkedin.com/jobs/view/4480192163/',
      sourceSite: 'linkedin',
      externalId: '4480192163',
      title: 'Senior Full Stack Engineer',
      company: 'AutoGrab',
      location: 'Melbourne, Victoria, Australia',
      text: '',
    });
    expect(new Set(found.map((f) => f.card.externalId)).size).toBe(10);
    for (const f of found) {
      expect(f.element.getAttribute('data-entity-urn')).toBe(`urn:li:jobPosting:${f.card.externalId}`);
      expect(f.card.canonicalUrl).toBe(`https://www.linkedin.com/jobs/view/${f.card.externalId}/`);
      expect(f.card.title).not.toBe('');
      expect(f.card.company).toBeTruthy();
      expect(f.card.location).toBeTruthy();
      expect(repeats(f)).toEqual([]);
      // The title is a heading of its own; the card's link covers the whole card.
      expect(f.anchor.matches('h3.base-search-card__title')).toBe(true);
      expect(f.element.contains(f.anchor)).toBe(true);
    }
  });
});

describe('Indeed', () => {
  it('reads a job page, without the hidden " - job post" in the title', () => {
    const { extractor, capture } = page('indeed-job.html', 'https://au.indeed.com/viewjob?jk=a1b2c3d4e5f60718&from=serp');
    expect(extractor.id).toBe('indeed');
    expect(capture).toMatchObject({
      title: 'Business Analyst',
      company: 'Harbour Talent',
      location: 'Brisbane QLD',
      canonicalUrl: 'https://au.indeed.com/viewjob?jk=a1b2c3d4e5f60718',
      externalId: 'a1b2c3d4e5f60718',
    });
    expect(capture!.jdText).toContain('• 5 years as a Business Analyst');
  });

  it('reads the open job on a search page (vjk)', () => {
    const { capture } = page('indeed-search.html', 'https://au.indeed.com/jobs?q=analyst&l=Brisbane&vjk=0f1e2d3c4b5a6978');
    expect(capture).toMatchObject({ title: 'Data Analyst', company: 'Queensland Health', externalId: '0f1e2d3c4b5a6978' });
  });

  it('finds the job cards on a search page, and skips a sponsored card with no job key', () => {
    const found = cardsOn('indeed-search.html', 'https://au.indeed.com/jobs?q=analyst&l=Brisbane');
    expect(found.map((f) => f.card)).toEqual([
      {
        canonicalUrl: 'https://au.indeed.com/viewjob?jk=a1b2c3d4e5f60718',
        sourceSite: 'indeed',
        externalId: 'a1b2c3d4e5f60718',
        title: 'Business Analyst',
        company: 'Harbour Talent',
        location: 'Brisbane QLD',
        // Not "Save" or when it was posted.
        text: [
          '$110,000 – $125,000 a year',
          'Permanent',
          'Full-time',
          'Turn what the product teams need into clear requirements.',
          'Five years as a Business Analyst in financial services.',
        ].join('\n'),
      },
      {
        canonicalUrl: 'https://au.indeed.com/viewjob?jk=0f1e2d3c4b5a6978',
        sourceSite: 'indeed',
        externalId: '0f1e2d3c4b5a6978',
        // Not the "new" label.
        title: 'Data Analyst',
        company: 'Queensland Health',
        location: 'Brisbane QLD 4000',
        text: 'Full-time\nBuild reports in SQL and Power BI for the reporting team.',
      },
    ]);
    for (const f of found) {
      expect(f.anchor.tagName).toBe('H2');
      expect(f.element.contains(f.anchor)).toBe(true);
    }
  });
});

describe('job cards on a search list', () => {
  it("leave out when each job was listed: it changes every day, and the server caches quick ratings by the card's text", () => {
    const pages: [string, string][] = [
      ['seek-search-real.html', 'https://au.seek.com/full-stack-developer-jobs/in-All-Melbourne-VIC'],
      ['linkedin-guest-search.html', 'https://www.linkedin.com/jobs/search?keywords=Full%20Stack%20Developer'],
    ];
    for (const [file, href] of pages) {
      const found = cardsOn(file, href);
      expect(found.length).toBeGreaterThan(0);
      for (const { card } of found) {
        // "Listed seven hours ago", "7h ago", "1 week ago", <time datetime="2026-10-15">.
        expect(card.text).not.toMatch(/\bago\b|\blisted\b|\bposted\b|\d{4}-\d{2}-\d{2}/i);
      }
    }
  });

  it('a card has no button text, and keeps to 4000 characters', () => {
    const teaser = 'Build things. '.repeat(400);
    const { document } = parseHTML(
      `<!doctype html><html><body><article data-automation="normalJob" data-job-id="81234570"><h3><a data-automation="jobTitle" href="/job/81234570">Engineer</a></h3><span data-automation="jobSalary">$100,000<button>Save</button></span><span data-automation="jobShortDescription">${teaser}</span></article></body></html>`,
    );
    const url = new URL('https://www.seek.com.au/engineer-jobs');
    const [found] = pickExtractor(url).readCards(document as unknown as Document, url);
    expect(found!.card.text.startsWith('$100,000\nBuild things.')).toBe(true);
    expect(found!.card.text).toHaveLength(4000);
  });
});

describe('any other site', () => {
  it("uses the page's JobPosting data", () => {
    const { extractor, capture } = page('generic-jsonld.html', 'https://careers.kestrel.example/jobs/platform-engineer');
    expect(extractor.id).toBe('generic');
    expect(capture).toMatchObject({
      title: 'Platform Engineer',
      company: 'Kestrel Software',
      location: 'Melbourne VIC',
      sourceSite: 'other',
      externalId: null,
      canonicalUrl: 'https://careers.kestrel.example/jobs/platform-engineer',
    });
    expect(capture!.jdText).toContain('Kestrel builds scheduling software for hospitals.');
    expect(capture!.structured).toMatchObject({ workMode: 'remote' });
  });

  it("uses the page's readable text when there's no JobPosting data", () => {
    const { capture } = page('generic-article.html', 'https://brightwater.example/careers/senior-data-analyst');
    expect(capture!.title).toBe('Senior Data Analyst');
    expect(capture!.jdText).toContain('Write SQL to pull and clean data');
    expect(capture!.jdText).not.toContain('About');
  });

  it('uses the text you selected, when there is enough of it', () => {
    const selected = 'Junior Developer at Acme. '.repeat(12);
    const { capture } = page('generic-article.html', 'https://brightwater.example/careers/senior-data-analyst', { selection: selected });
    expect(capture!.jdText).toBe(selected.trim());
  });

  it('has no job cards to read', () => {
    expect(cardsOn('generic-article.html', 'https://brightwater.example/careers/senior-data-analyst')).toEqual([]);
  });
});

describe('a page still loading', () => {
  it('has nothing to read yet, rather than an empty ad', () => {
    const { parseHTML: parse } = { parseHTML };
    const { document } = parse('<!doctype html><html><body><div data-automation="jobDetailsPage"></div></body></html>');
    const url = new URL('https://www.seek.com.au/job/81234567');
    expect(pickExtractor(url).extract(document as unknown as Document, url, now)).toBeNull();
  });

  it('a title with no ad text yet is not a read job: it waits for the description', () => {
    const { document } = parseHTML(
      '<!doctype html><html><body><div class="jobs-search__job-details--container"><div class="job-details-jobs-unified-top-card__job-title"><h1>Senior UX Designer</h1></div><div id="job-details"></div></div></body></html>',
    );
    const url = new URL('https://www.linkedin.com/jobs/search/?currentJobId=4012345679');
    expect(pickExtractor(url).extract(document as unknown as Document, url, now)).toBeNull();
  });

  it("on a Seek search page with the pane still empty, the page's own heading is not taken for the job", () => {
    const { document } = parseHTML(
      '<!doctype html><html><body><h1>Software Engineer jobs in Sydney NSW</h1><aside data-automation="splitViewJobDetailsWrapper"></aside></body></html>',
    );
    const url = new URL('https://www.seek.com.au/software-engineer-jobs?jobId=81234568');
    expect(pickExtractor(url).extract(document as unknown as Document, url, now)).toBeNull();
  });

  it('a split pane that shows a different job than the address (still loading) is not read', () => {
    const { document } = parseHTML(
      '<!doctype html><html><body><div class="jobs-search__job-details--container"><div class="job-details-jobs-unified-top-card__job-title"><h1><a href="/jobs/view/4012345678/">Product Designer</a></h1></div><div id="job-details"><p>The old job.</p></div></div></body></html>',
    );
    const url = new URL('https://www.linkedin.com/jobs/search/?currentJobId=4012345679');
    expect(pickExtractor(url).extract(document as unknown as Document, url, now)).toBeNull();
  });
});

