// The AI's state for the header pill: loaded once, then kept up to date by
// live events from the server.

import type { AiState } from '../../../shared/contracts/index.ts';
import { api } from './api.ts';
import { onLive, onReconnect } from './live.svelte.ts';

export const AI_LABEL: Record<AiState, string> = {
  off: 'AI off',
  starting: 'AI starting…',
  ready: 'AI ready',
  busy: 'AI working…',
  error: 'AI problem',
};

// Moves the cursor to Settings → AI, for the pill and for keyboard users.
export function focusAiSettings(): void {
  const heading = document.getElementById('ai-heading');
  heading?.scrollIntoView();
  heading?.focus();
}

export const ai = $state<{ state: AiState; detail: string | null; known: boolean }>({ state: 'off', detail: null, known: false });

export function watchAi(): () => void {
  const refresh = () =>
    api
      .aiStatus()
      .then((status) => {
        ai.state = status.state;
        ai.detail = status.detail;
        ai.known = true;
      })
      .catch(() => {
        // The server may be restarting; the next live event fills this in.
      });
  void refresh();
  const offEvents = onLive(['ai.stateChanged'], (_name, payload) => {
    const p = payload as { state: AiState; detail: string | null };
    ai.state = p.state;
    ai.detail = p.detail;
    ai.known = true;
  });
  const offReconnect = onReconnect(() => void refresh());
  return () => {
    offEvents();
    offReconnect();
  };
}
