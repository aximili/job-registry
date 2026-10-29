// The words on an Inbox card. Plain functions, so they're tested without a browser.

import type { EmailEvent, Status } from '../../../shared/contracts/index.ts';
import { EMAIL_EVENT_LABEL } from '../../../shared/labels.ts';
import { displayTitle } from './format.ts';

const label = (id: string, statuses: Status[]): string => statuses.find((s) => s.id === id)?.label ?? id;

export function eventLabel(event: EmailEvent): string {
  return EMAIL_EVENT_LABEL[event];
}

export function questionFor(s: { suggestedStatus: string | null }, statuses: Status[]): string {
  return s.suggestedStatus ? `Mark as ${label(s.suggestedStatus, statuses)}?` : 'Add it as a note?';
}

export function doneMessage(s: { appliedStatus: string | null; job: { title: string | null } | null }, statuses: Status[]): string {
  const title = displayTitle(s.job?.title ?? null);
  return s.appliedStatus ? `Marked ${title} as ${label(s.appliedStatus, statuses)}.` : `Added a note to ${title}.`;
}
