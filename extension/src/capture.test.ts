import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { fallbackCapture } from './capture.ts';
import { removeStalePanels } from './panel/stale.ts';

const now = new Date('2026-10-28T03:15:00Z');

function doc(html: string, selection = '') {
  const { document } = parseHTML(html);
  (document as unknown as { getSelection: () => { toString: () => string } }).getSelection = () => ({ toString: () => selection });
  return document as unknown as Document;
}

describe('saving a job the reader could not read', () => {
  it("on a search page, the page's own heading is not taken for the job's title", () => {
    const page = doc('<!doctype html><html><body><h1>Software Engineer jobs in Sydney NSW</h1><p>lots of results</p></body></html>', 'The job ad text that I selected.');
    const capture = fallbackCapture(page, new URL('https://www.seek.com.au/software-engineer-jobs?jobId=81234568'), now, 'selection');
    expect(capture).toMatchObject({ jdText: 'The job ad text that I selected.', canonicalUrl: 'https://www.seek.com.au/job/81234568' });
    expect(capture?.title).toBeUndefined();
  });

  it("on the job's own page, its heading is the title", () => {
    const page = doc('<!doctype html><html><body><h1>Mystery Role</h1><p>text</p></body></html>', 'Selected ad text.');
    expect(fallbackCapture(page, new URL('https://www.seek.com.au/job/99999999'), now, 'selection')?.title).toBe('Mystery Role');
  });

  it('nothing selected means nothing to save', () => {
    const page = doc('<!doctype html><html><body><h1>Mystery Role</h1></body></html>');
    expect(fallbackCapture(page, new URL('https://www.seek.com.au/job/99999999'), now, 'selection')).toBeNull();
  });
});

describe('a panel left over from an older copy of the extension', () => {
  it('is removed before a new one is added', () => {
    const page = doc('<!doctype html><html><body><p>site</p><job-registry-panel></job-registry-panel></body></html>');
    removeStalePanels(page);
    expect(page.querySelectorAll('job-registry-panel')).toHaveLength(0);
    expect(page.querySelector('p')).not.toBeNull();
  });
});
