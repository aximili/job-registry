// The AI in use and its state, for the header's AI switcher: loaded once,
// then kept up to date by live events from the server. Also which saved AIs
// have an API key, so the switcher can say which have none yet.

import { activeAi, type AiState, type SavedAi } from '../../../shared/contracts/index.ts';
import { noKeyYet, switchMessage } from './ai-list.ts';
import { api } from './api.ts';
import { app } from './app-state.svelte.ts';
import { friendlyError } from './errors.ts';
import { onLive, onReconnect } from './live.svelte.ts';
import { showToast } from './toast.svelte.ts';

export const AI_LABEL: Record<AiState, string> = {
  off: 'AI off',
  starting: 'AI starting…',
  ready: 'AI ready',
  busy: 'AI working…',
  error: 'AI problem',
};

// The state on its own, beside the AI's name: "Bonsai 2 · ready".
export const AI_STATE_WORD: Record<AiState, string> = {
  off: 'off',
  starting: 'starting…',
  ready: 'ready',
  busy: 'working…',
  error: 'problem',
};

// Moves the cursor to Settings → AI, for the switcher and for keyboard users.
export function focusAiSettings(): void {
  const heading = document.getElementById('ai-heading');
  heading?.scrollIntoView();
  heading?.focus();
}

// id and name are the AI in use. Empty until the first answer: then the
// switcher uses the settings' AI in use.
export const ai = $state<{ state: AiState; detail: string | null; known: boolean; id: string; name: string }>({
  state: 'off',
  detail: null,
  known: false,
  id: '',
  name: '',
});

// The ids of the saved AIs that have an API key (never the keys), or null
// until the server has said.
export const aiKeys = $state<{ ids: string[] | null }>({ ids: null });

// Asks the server again. A failure keeps what was known.
export function refreshAiKeys(): Promise<void> {
  return api
    .secretsStatus()
    .then((status) => {
      aiKeys.ids = status.aiKeys;
    })
    .catch(() => undefined);
}

// The name of the AI in use, once the status or the settings have said it.
// Before that, null: the built-in defaults would show Bonsai 2 even to
// someone whose AI is Claude.
export function aiInUseName(): string | null {
  if (ai.name) return ai.name;
  if (!app.loaded) return null;
  try {
    return activeAi(app.settings.ai).name;
  } catch {
    return null;
  }
}

export function watchAi(): () => void {
  const refresh = () =>
    api
      .aiStatus()
      .then((status) => {
        ai.state = status.state;
        ai.detail = status.detail;
        ai.id = status.id;
        ai.name = status.name;
        ai.known = true;
      })
      .catch(() => {
        // The server may be restarting; the next live event fills this in.
      });
  void refresh();
  void refreshAiKeys();
  const offEvents = onLive(['ai.stateChanged'], (_name, payload) => {
    const p = payload as { state: AiState; detail: string | null; id?: string; name?: string };
    ai.state = p.state;
    ai.detail = p.detail;
    if (p.id) ai.id = p.id;
    if (p.name) ai.name = p.name;
    ai.known = true;
  });
  // A key saved or removed ("aiKeys"), or one deleted with its AI ("ai").
  const offKeys = onLive(['settings.changed'], () => void refreshAiKeys());
  const offReconnect = onReconnect(() => {
    void refresh();
    void refreshAiKeys();
  });
  return () => {
    offEvents();
    offKeys();
    offReconnect();
  };
}

// Switch the whole app to another saved AI, at once, and say so. The
// settings come back with the switch, so every list marks the new one.
// Returns false when the switch was refused (the toast says why).
export async function switchAi(id: string): Promise<boolean> {
  let from: SavedAi | null = null;
  try {
    from = activeAi(app.settings.ai);
  } catch {
    // Settings not loaded yet: there's nothing to warn about.
  }
  if (from?.id === id) return true;
  try {
    const settings = await api.useAi(id);
    app.settings = settings;
    const to = activeAi(settings.ai);
    ai.id = to.id;
    ai.name = to.name;
    showToast(switchMessage(from, to, { noKey: noKeyYet(to, aiKeys.ids) }));
    return true;
  } catch (err) {
    showToast(friendlyError(err));
    return false;
  }
}
