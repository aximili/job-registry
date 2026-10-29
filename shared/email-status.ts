// Which status an email points to, worked out by plain code, never by the AI.
// It only ever suggests a move forward, and you confirm every one. Shared, so
// the Inbox can work it out again when you pick another job.

import type { EmailEvent, Status } from './contracts/index.ts';

const INTERVIEWS = ['interview_1', 'interview_2', 'final_interview'];
const TARGET: Partial<Record<EmailEvent, string>> = {
  received: 'applied',
  rejected: 'rejected',
  assessment: 'screening',
  offer: 'offer',
};

export function suggestStatus(event: EmailEvent, current: string, statuses: Status[]): string | null {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  const now = byId.get(current);
  // A status your settings no longer have counts as the earliest.
  const order = now?.order ?? Number.NEGATIVE_INFINITY;
  // A closed job reopens only for an interview or an offer.
  if (now?.closed && event !== 'interview' && event !== 'offer') return null;

  const ahead = (id: string): boolean => {
    const target = byId.get(id);
    return target !== undefined && id !== current && (target.order > order || (now?.closed ?? false));
  };

  if (event === 'interview') {
    const next = INTERVIEWS.filter((id) => byId.has(id))
      .sort((a, b) => byId.get(a)!.order - byId.get(b)!.order)
      .find((id) => (now?.closed ? true : byId.get(id)!.order > order));
    return next !== undefined && ahead(next) ? next : null;
  }
  const target = TARGET[event];
  if (!target) return null;
  // A rejection can come at any open stage, even after an offer.
  if (event === 'rejected') return byId.has(target) && target !== current ? target : null;
  return ahead(target) ? target : null;
}
