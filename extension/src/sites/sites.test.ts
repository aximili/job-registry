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

