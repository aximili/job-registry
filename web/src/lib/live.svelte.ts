// One shared connection to the server's live events. Pages subscribe to the
// event names they care about, and reload their data when one arrives. The
// stream closes while the tab is hidden (see live-connection.ts).

import { createLiveConnection } from './live-connection.ts';

const live = createLiveConnection({
  open: () => new EventSource('/api/v1/events'),
  isHidden: () => document.visibilityState === 'hidden',
  onVisibilityChange: (fn) => {
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  },
});

export function onLive(names: string[], handler: (name: string, payload: unknown) => void): () => void {
  return live.on(names, handler);
}

// After the stream comes back (the tab was hidden, or the app restarted),
// events may have been missed: reload what's on screen.
export function onReconnect(fn: () => void): () => void {
  return live.onReconnect(fn);
}

export const JOB_EVENTS = [
  'job.saved',
  'job.updated',
  'job.statusChanged',
  'posting.added',
  'note.added',
  'note.updated',
  'note.removed',
  'contact.saved',
  'contact.linked',
  'contact.unlinked',
  'interaction.logged',
  'document.saved',
  'document.sent',
  'attachment.added',
];
