import { describe, expect, it } from 'vitest';
import type { DocumentSummary } from '../../../shared/contracts/index.ts';
import { draftKey, KIND_LABEL, sentLine, versionLabel } from './documents.ts';

const NOW = new Date('2026-10-28T03:15:00.000Z');

function doc(over: Partial<DocumentSummary>): DocumentSummary {
  return {
    id: 1,
    jobId: 7,
    kind: 'resume',
    version: 1,
    origin: 'edited',
    copiedFromId: null,
    isSent: false,
    sentAt: null,
    createdAt: '2026-10-28T01:00:00.000Z',
    ...over,
  };
}

describe('versionLabel', () => {
  it('names the version, how it came to be, and when', () => {
    expect(versionLabel(doc({ version: 3 }), NOW)).toBe('Version 3 · edited · 28 Oct');
    expect(versionLabel(doc({ origin: 'generated' }), NOW)).toBe('Version 1 · written by the AI · 28 Oct');
    expect(versionLabel(doc({ origin: 'copied', createdAt: '2025-12-01T01:00:00.000Z' }), NOW)).toBe('Version 1 · copied · 1 Dec 2025');
  });

  it('a sent version says when it was sent', () => {
    expect(versionLabel(doc({ version: 2, isSent: true, sentAt: '2026-10-27T01:00:00.000Z' }), NOW)).toBe('Version 2 · sent 27 Oct');
  });
});

describe('sentLine', () => {
  it('lists what was sent, or nothing', () => {
    expect(sentLine({ resume: null, coverLetter: null }, NOW)).toBeNull();
    const resume = doc({ version: 2, isSent: true, sentAt: '2026-10-27T01:00:00.000Z' });
    const letter = doc({ id: 2, kind: 'cover_letter', isSent: true, sentAt: '2026-10-28T01:00:00.000Z' });
    expect(sentLine({ resume, coverLetter: null }, NOW)).toBe('Resume v2 (27 Oct)');
    expect(sentLine({ resume, coverLetter: letter }, NOW)).toBe('Resume v2 (27 Oct) · Cover letter v1 (28 Oct)');
  });
});

it('labels and draft keys', () => {
  expect(KIND_LABEL).toEqual({ resume: 'Resume', cover_letter: 'Cover letter' });
  expect(draftKey(7, 'cover_letter')).toBe('jr-draft:7:cover_letter');
});
