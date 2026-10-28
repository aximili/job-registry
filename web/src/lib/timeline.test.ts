import { expect, it } from 'vitest';
import type { CallSheet } from '../../../shared/contracts/index.ts';
import { buildTimeline } from './timeline.ts';

const at = (h: number) => new Date(Date.UTC(2026, 9, 28, h)).toISOString();

it('merges status changes, notes, calls and ads newest first with the agreed text', () => {
  const sheet = {
    job: {} as CallSheet['job'],
    postings: [
      {
        id: 1, jobId: 1, canonicalUrl: null, sourceSite: 'seek', externalId: '1',
        sourceUrl: null, jdText: '', capturedAt: at(1),
      },
      {
        id: 2, jobId: 1, canonicalUrl: null, sourceSite: 'pasted', externalId: null,
        sourceUrl: null, jdText: '', capturedAt: at(6),
      },
    ],
    history: [
      { id: 2, jobId: 1, fromStatus: 'saved', toStatus: 'applied', source: 'manual', changedAt: at(3) },
      { id: 1, jobId: 1, fromStatus: null, toStatus: 'saved', source: 'manual', changedAt: at(2) },
    ],
    people: [],
    notes: [{ id: 1, jobId: 1, body: 'Sent v2 of my resume', createdAt: at(4), updatedAt: at(4) }],
    interactions: [
      { id: 1, contactId: 1, contactName: 'Priya Shah', jobId: 1, kind: 'call', happenedAt: at(5), notes: 'Panel next week' },
      { id: 2, contactId: null, contactName: null, jobId: 1, kind: 'email', happenedAt: at(7), notes: '' },
    ],
  } satisfies CallSheet;

  const labels: Record<string, string> = { saved: 'Saved', applied: 'Applied' };
  expect(buildTimeline(sheet, (id) => labels[id] ?? id)).toEqual([
    { at: at(7), kind: 'call', text: 'Email with someone' },
    { at: at(6), kind: 'ad', text: 'Ad pasted in' },
    { at: at(5), kind: 'call', text: 'Call with Priya Shah: Panel next week' },
    { at: at(4), kind: 'note', text: 'Sent v2 of my resume' },
    { at: at(3), kind: 'status', text: 'Saved → Applied' },
    { at: at(2), kind: 'status', text: 'Saved' },
    { at: at(1), kind: 'ad', text: 'Ad saved from Seek' },
  ]);
});
