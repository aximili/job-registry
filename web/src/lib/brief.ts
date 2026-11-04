// The editor's "Before I write": a change you make to the brief, what an
// edit sends, and the words around it (who's working, for how long, the
// main button, the toast after answers go in your master profile).

import type { Brief, BriefEdits, DocumentKind } from '../../../shared/contracts/index.ts';

type Question = Brief['questions'][number];

// One change, as you make it: a click, or what you've typed so far.
export type BriefChange =
  | { kind: 'name'; name: string }
  | { kind: 'recruiter'; recruiter: boolean }
  | { kind: 'story'; need: number; chosen: number }
  | { kind: 'drop'; need: number; dropped: boolean }
  | { kind: 'answer'; question: number; answer: string }
  | { kind: 'skip'; question: number; skipped: boolean }
  | { kind: 'add'; question: number; add: boolean };

// The brief with one change made. The brief given is left as it was.
export function applyChange(brief: Brief, change: BriefChange): Brief {
  const needs = (i: number, patch: Partial<Brief['needs'][number]>) => brief.needs.map((n, at) => (at === i ? { ...n, ...patch } : n));
  const questions = (i: number, patch: (q: Question) => Partial<Question>) =>
    brief.questions.map((q, at) => (at === i ? { ...q, ...patch(q) } : q));
  switch (change.kind) {
    case 'name':
      return { ...brief, contact: { ...brief.contact, name: change.name } };
    case 'recruiter':
      return { ...brief, contact: { ...brief.contact, recruiter: change.recruiter } };
    case 'story':
      return { ...brief, needs: needs(change.need, { chosen: change.chosen }) };
    case 'drop':
      return { ...brief, needs: needs(change.need, { dropped: change.dropped }) };
    case 'answer':
      // A changed answer goes in your profile again, as a new line.
      return { ...brief, questions: questions(change.question, (q) => ({ answer: change.answer, addedAt: change.answer === q.answer ? q.addedAt : null })) };
    case 'skip':
      return { ...brief, questions: questions(change.question, () => ({ skipped: change.skipped })) };
    case 'add':
      return { ...brief, questions: questions(change.question, () => ({ addToProfile: change.add })) };
  }
}

const orNull = (text: string | null): string | null => (text?.trim() ? text : null);

// Everything you can change, as an edit sends it: one entry for each of the
// brief's needs and questions, in order. So the last edit always wins.
export function editsOf(brief: Brief): BriefEdits {
  return {
    contact: { name: orNull(brief.contact.name), recruiter: brief.contact.recruiter },
    needs: brief.needs.map((n) => ({ chosen: n.chosen, dropped: n.dropped })),
    questions: brief.questions.map((q) => ({ answer: orNull(q.answer), skipped: q.skipped, addToProfile: q.addToProfile })),
  };
}

// A saved edit, back from the server: what you've typed since stays as it
// is, and the server's times come in (when it was saved, and when each
// answer went in your profile).
export function mergeSaved(local: Brief, saved: Brief): Brief {
  return {
    ...local,
    updatedAt: saved.updatedAt,
    approvedAt: saved.approvedAt,
    questions: local.questions.map((q, i) => ({ ...q, addedAt: saved.questions[i]?.addedAt ?? null })),
  };
}

// "0:07", "1:05", "10:00".
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// Who's making the brief or writing the draft, and whether it has started.
export type Progress = { task: 'brief' | 'draft'; phase: 'waiting' | 'working'; by: string };

export function progressText(p: Progress): string {
  if (p.phase === 'waiting') return `Waiting for ${p.by}…`;
  return p.task === 'brief' ? `${p.by} is making the brief…` : `${p.by} is writing…`;
}

// The toast once your ticked answers are in your master profile, or none.
export function answersAdded(n: number): string | null {
  if (n === 0) return null;
  return n === 1 ? 'Added 1 answer to your master profile.' : `Added ${n} answers to your master profile.`;
}

export const writeLabel = (kind: DocumentKind): string => (kind === 'resume' ? 'Write the resume' : 'Write the cover letter');
