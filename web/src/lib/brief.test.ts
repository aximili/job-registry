import { describe, expect, it } from 'vitest';
import type { Brief } from '../../../shared/contracts/index.ts';
import { answersAdded, applyChange, clock, editsOf, mergeSaved, progressText, writeLabel } from './brief.ts';

const story = (title: string) => ({ title, text: `${title}, told in a sentence.` });

function brief(): Brief {
  return {
    id: 7,
    jobId: 3,
    by: 'Bonsai 2',
    createdAt: '2026-11-04T01:00:00.000Z',
    updatedAt: '2026-11-04T01:00:00.000Z',
    approvedAt: null,
    contact: { name: 'Alex', email: 'alex@example-recruit.com.au', recruiter: true, organisation: 'Example Recruit' },
    opening: { quote: 'Ship faster.', why: 'I cut build times.', inAd: true },
    needs: [
      { need: 'TypeScript', stories: [story('Moving to TypeScript'), story('Senior at Example Co')], chosen: 0, dropped: false },
      { need: 'Fast builds', stories: [story('Cutting build times')], chosen: 0, dropped: false },
    ],
    gaps: [{ mustHave: 'Go', evidence: 'None yet.' }],
    questions: [
      { question: 'Used Go?', why: 'The ad asks.', answer: 'A little.', skipped: false, addToProfile: true, addedAt: '2026-11-03T05:00:00.000Z', fromEarlier: true },
      { question: 'Name the app?', why: 'Stronger.', answer: null, skipped: false, addToProfile: false, addedAt: null, fromEarlier: false },
    ],
  };
}

describe('a change to the brief', () => {
  it('fixes the contact’s name and whether it’s a recruiter', () => {
    expect(applyChange(brief(), { kind: 'name', name: 'Alex Lee' }).contact).toMatchObject({ name: 'Alex Lee', recruiter: true });
    expect(applyChange(brief(), { kind: 'recruiter', recruiter: false }).contact).toMatchObject({ name: 'Alex', recruiter: false });
  });

  it('swaps a need’s story, and drops a need or brings it back', () => {
    const swapped = applyChange(brief(), { kind: 'story', need: 0, chosen: 1 });
    expect(swapped.needs.map((n) => n.chosen)).toEqual([1, 0]);
    const dropped = applyChange(brief(), { kind: 'drop', need: 1, dropped: true });
    expect(dropped.needs.map((n) => n.dropped)).toEqual([false, true]);
    expect(applyChange(dropped, { kind: 'drop', need: 1, dropped: false }).needs[1]!.dropped).toBe(false);
  });

  it('answers a question, skips one, and ticks Add to my profile', () => {
    let b = applyChange(brief(), { kind: 'answer', question: 1, answer: 'Yes, the Example Co app.' });
    b = applyChange(b, { kind: 'add', question: 1, add: true });
    b = applyChange(b, { kind: 'skip', question: 0, skipped: true });
    expect(b.questions.map((q) => [q.answer, q.skipped, q.addToProfile])).toEqual([
      ['A little.', true, true],
      ['Yes, the Example Co app.', false, true],
    ]);
  });

  it('a changed answer is no longer in your profile, so it goes in again', () => {
    const b = applyChange(brief(), { kind: 'answer', question: 0, answer: 'Two side projects.' });
    expect(b.questions[0]!.addedAt).toBeNull();
  });

  it('never changes the brief it was given', () => {
    const before = brief();
    applyChange(before, { kind: 'answer', question: 1, answer: 'Yes.' });
    applyChange(before, { kind: 'story', need: 0, chosen: 1 });
    expect(before).toEqual(brief());
  });
});

describe('what an edit sends', () => {
  it('sends every part you can change, one entry for each of the brief’s own', () => {
    const b = applyChange(applyChange(brief(), { kind: 'drop', need: 1, dropped: true }), { kind: 'answer', question: 1, answer: 'Yes.' });
    expect(editsOf(b)).toEqual({
      contact: { name: 'Alex', recruiter: true },
      needs: [
        { chosen: 0, dropped: false },
        { chosen: 0, dropped: true },
      ],
      questions: [
        { answer: 'A little.', skipped: false, addToProfile: true },
        { answer: 'Yes.', skipped: false, addToProfile: false },
      ],
    });
  });

  it('an empty name or answer is sent as none', () => {
    const b = applyChange(applyChange(brief(), { kind: 'name', name: '  ' }), { kind: 'answer', question: 0, answer: '' });
    expect(editsOf(b).contact!.name).toBeNull();
    expect(editsOf(b).questions![0]!.answer).toBeNull();
  });
});

describe('a saved edit, back from the server', () => {
  it('keeps what you typed since, and takes the server’s times', () => {
    const local = applyChange(brief(), { kind: 'answer', question: 1, answer: 'Yes, the Example ' });
    const saved = { ...brief(), updatedAt: '2026-11-04T02:00:00.000Z', questions: brief().questions.map((q) => ({ ...q, addedAt: null })) };
    const merged = mergeSaved(local, saved);
    expect(merged.questions[1]!.answer).toBe('Yes, the Example ');
    expect(merged.updatedAt).toBe('2026-11-04T02:00:00.000Z');
    expect(merged.questions[0]!.addedAt).toBeNull();
  });
});

describe('the words around a brief', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [7_000, '0:07'],
    [65_400, '1:05'],
    [600_000, '10:00'],
  ])('%i ms reads as %s', (ms, text) => {
    expect(clock(ms)).toBe(text);
  });

  it('says who is making the brief or writing, and while it waits', () => {
    expect(progressText({ task: 'brief', phase: 'waiting', by: 'Claude – mine' })).toBe('Waiting for Claude – mine…');
    expect(progressText({ task: 'brief', phase: 'working', by: 'Claude – mine' })).toBe('Claude – mine is making the brief…');
    expect(progressText({ task: 'draft', phase: 'waiting', by: 'Bonsai 2' })).toBe('Waiting for Bonsai 2…');
    expect(progressText({ task: 'draft', phase: 'working', by: 'Bonsai 2' })).toBe('Bonsai 2 is writing…');
  });

  it('counts the answers added to your master profile', () => {
    expect(answersAdded(0)).toBeNull();
    expect(answersAdded(1)).toBe('Added 1 answer to your master profile.');
    expect(answersAdded(3)).toBe('Added 3 answers to your master profile.');
  });

  it('names the main button for the document', () => {
    expect(writeLabel('cover_letter')).toBe('Write the cover letter');
    expect(writeLabel('resume')).toBe('Write the resume');
  });
});
