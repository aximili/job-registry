// One shared connection to the server's live events. Pages subscribe to the
// event names they care about, and reload their data when one arrives.

type Handler = (name: string, payload: unknown) => void;

const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;

function connect(): EventSource {
  if (!source) source = new EventSource('/api/v1/events');
  return source;
}

export function onLive(names: string[], handler: Handler): () => void {
  const es = connect();
  const listeners: [string, (e: MessageEvent) => void][] = [];
  for (const name of names) {
    let set = handlers.get(name);
    if (!set) {
      set = new Set();
      handlers.set(name, set);
    }
    set.add(handler);
    const listener = (e: MessageEvent) => handler(name, JSON.parse(e.data as string));
    es.addEventListener(name, listener);
    listeners.push([name, listener]);
  }
  return () => {
    for (const [name, listener] of listeners) {
      es.removeEventListener(name, listener);
      handlers.get(name)?.delete(handler);
    }
  };
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
];
