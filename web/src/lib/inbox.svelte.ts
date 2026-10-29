// How many emails wait in the Inbox, for the header's count. Kept fresh by
// the live email events and by settings changes (turning email on or off).

import type { EmailStatus } from '../../../shared/contracts/index.ts';
import { api } from './api.ts';
import { onLive, onReconnect } from './live.svelte.ts';

export const inbox = $state({ status: null as EmailStatus | null });

export async function refreshInbox(): Promise<EmailStatus> {
  const status = await api.emailStatus();
  inbox.status = status;
  return status;
}

export const EMAIL_EVENTS = ['email.suggestionsAdded', 'email.suggestionHandled', 'email.checked', 'settings.changed'];

export function watchInbox(): () => void {
  const refresh = () => void refreshInbox().catch(() => undefined);
  refresh();
  const off = onLive(EMAIL_EVENTS, refresh);
  const offReconnect = onReconnect(refresh);
  return () => {
    off();
    offReconnect();
  };
}
