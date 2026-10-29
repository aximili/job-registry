import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capture } from '../../shared/contracts/index.ts';
import type { SiteExtractor } from './sites/index.ts';
import { watchJobs } from './watcher.ts';

// A tiny site: the job id is in ?id=, and its details are an <h1>.
const site: SiteExtractor = {
  id: 'seek',
  matches: () => true,
  currentJobId: (url) => url.searchParams.get('id'),
  extract(doc, url, now) {
    const title = doc.querySelector('h1')?.textContent?.trim();
    if (!title) return null;
    const ad = doc.querySelector('p')?.textContent?.trim() ?? title;
    return { sourceUrl: url.href, canonicalUrl: url.href, sourceSite: 'seek', externalId: url.searchParams.get('id'), title, jdText: ad, capturedAt: now.toISOString() } as Capture;
  },
  readCards: () => [],
};

let href = 'https://example.com/jobs?id=1';
let doc: Document;
let stop: () => void;
const seen: { jobId: string | null; title: string | null }[] = [];
let left = 0;

function start() {
  stop = watchJobs({
    doc,
    location: () => new URL(href),
    extractor: () => site,
    onJob: (capture, jobId) => seen.push({ jobId, title: capture?.title ?? null }),
    onLeave: () => left++,
    now: () => new Date('2026-10-28T03:15:00Z'),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  seen.length = 0;
  left = 0;
  href = 'https://example.com/jobs?id=1';
  doc = parseHTML('<!doctype html><html><body><main></main></body></html>').document as unknown as Document;
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
});

const setTitle = (text: string) => {
  doc.querySelector('main')!.innerHTML = `<h1>${text}</h1>`;
};

describe('page watcher', () => {
  it('reports the job on screen once, as soon as its details are there', () => {
    setTitle('Job one');
    start();
    expect(seen).toEqual([{ jobId: '1', title: 'Job one' }]);
    vi.advanceTimersByTime(3000);
    expect(seen).toHaveLength(1);
  });

  it('notices a new job when the address changes without a reload', () => {
    setTitle('Job one');
    start();
    href = 'https://example.com/jobs?id=2';
    setTitle('Job two');
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([
      { jobId: '1', title: 'Job one' },
      { jobId: '2', title: 'Job two' },
    ]);
  });

  it('waits for details that appear late', () => {
    start();
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1000);
    setTitle('Slow job');
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([{ jobId: '1', title: 'Slow job' }]);
  });

  it("says it couldn't read a page that never fills in, after 5 seconds", () => {
    start();
    vi.advanceTimersByTime(4900);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(600);
    expect(seen).toEqual([{ jobId: '1', title: null }]);
  });

  it('clicking quickly through jobs reports only the last one', () => {
    start();
    href = 'https://example.com/jobs?id=2';
    vi.advanceTimersByTime(500);
    href = 'https://example.com/jobs?id=3';
    vi.advanceTimersByTime(500);
    setTitle('Job three');
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([{ jobId: '3', title: 'Job three' }]);
  });

  it('a page with no job on it reports nothing', () => {
    href = 'https://example.com/jobs';
    setTitle('A list of jobs');
    start();
    vi.advanceTimersByTime(6000);
    expect(seen).toEqual([]);
  });

  it('leaving the job for a page with no job on it says so once', () => {
    setTitle('Job one');
    start();
    href = 'https://example.com/jobs';
    vi.advanceTimersByTime(1500);
    expect(left).toBe(1);
  });

  it("never reports the last job's details under the new job's id while the pane is still loading", () => {
    setTitle('Job one');
    start();
    // The address changes first; the site fetches job two and fills the pane later.
    href = 'https://example.com/jobs?id=2';
    vi.advanceTimersByTime(800);
    expect(seen).toEqual([{ jobId: '1', title: 'Job one' }]);
    setTitle('Job two');
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([
      { jobId: '1', title: 'Job one' },
      { jobId: '2', title: 'Job two' },
    ]);
  });

  it("if the pane never changes, it says it couldn't read the new job, not the old one", () => {
    setTitle('Job one');
    start();
    href = 'https://example.com/jobs?id=2';
    vi.advanceTimersByTime(5600);
    expect(seen).toEqual([
      { jobId: '1', title: 'Job one' },
      { jobId: '2', title: null },
    ]);
  });

  it('reports the job again when more of it arrives soon after (title first, then the ad)', () => {
    doc.querySelector('main')!.innerHTML = '<h1>Job one</h1>';
    start();
    doc.querySelector('main')!.innerHTML = '<h1>Job one</h1><p>The full ad.</p>';
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([
      { jobId: '1', title: 'Job one' },
      { jobId: '1', title: 'Job one' },
    ]);
  });

  it('a reader that throws counts as "nothing read yet", so the panel never sticks on loading', () => {
    const throwing: SiteExtractor = { ...site, extract: () => { throw new Error('boom'); } };
    stop = watchJobs({ doc, location: () => new URL(href), extractor: () => throwing, onJob: (c, id) => seen.push({ jobId: id, title: c?.title ?? null }), now: () => new Date() });
    vi.advanceTimersByTime(5600);
    expect(seen).toEqual([{ jobId: '1', title: null }]);
  });

  it('coming back to a job you saw a moment ago reads it again (via a page with no job)', () => {
    setTitle('Job one');
    start();
    href = 'https://example.com/jobs';
    vi.advanceTimersByTime(500);
    href = 'https://example.com/jobs?id=1';
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([
      { jobId: '1', title: 'Job one' },
      { jobId: '1', title: 'Job one' },
    ]);
  });

  it('coming straight back after a quick click elsewhere reads the job again', () => {
    setTitle('Job one');
    start();
    href = 'https://example.com/jobs?id=2';
    vi.advanceTimersByTime(500);
    href = 'https://example.com/jobs?id=1';
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([
      { jobId: '1', title: 'Job one' },
      { jobId: '1', title: 'Job one' },
    ]);
  });

  it('a job that appears after "couldn\'t read" is still reported', () => {
    start();
    vi.advanceTimersByTime(5600);
    expect(seen).toEqual([{ jobId: '1', title: null }]);
    setTitle('Slow LinkedIn job');
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([
      { jobId: '1', title: null },
      { jobId: '1', title: 'Slow LinkedIn job' },
    ]);
  });
});

