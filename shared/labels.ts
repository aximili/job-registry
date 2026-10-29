// Words shared by the dashboard and the extension, so both say the same thing.

import type { EmailEvent, SourceSite, Verdict } from './contracts/index.ts';

export function verdictLabel(verdict: Verdict): string {
  return { strong: 'Strong match', good: 'Good match', stretch: 'Stretch', weak: 'Weak match' }[verdict];
}

export const SITE_NAME: Record<SourceSite, string> = {
  seek: 'Seek',
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  other: 'another website',
  pasted: 'pasted text',
};

// "Seek, LinkedIn and pasted text".
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

// What an email was about, on an Inbox card and in the note it leaves.
export const EMAIL_EVENT_LABEL: Record<EmailEvent, string> = {
  received: 'Application received',
  rejected: 'Rejection',
  interview: 'Interview invitation',
  assessment: 'Assessment',
  offer: 'Offer',
  other: 'Other email',
};
