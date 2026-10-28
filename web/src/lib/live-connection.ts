// The dashboard's one live-events stream, which closes while the tab is
// hidden. A browser allows only six open connections per address, so six
// background tabs each holding a stream would stall every request.
// When the stream opens again, or the browser reconnects it by itself (say,
// after the app restarted), pages are told to reload, because they may have
// missed events in between.

export type EventSourceLike = {
  addEventListener(name: string, fn: (e: MessageEvent) => void): void;
  removeEventListener(name: string, fn: (e: MessageEvent) => void): void;
  close(): void;
};

type Handler = (name: string, payload: unknown) => void;

export function createLiveConnection(opts: {
  open: () => EventSourceLike;
  isHidden: () => boolean;
  onVisibilityChange: (fn: () => void) => () => void;
}) {
  const handlers = new Map<string, Set<Handler>>();
  const reconnects = new Set<() => void>();
  let source: EventSourceLike | null = null;
  let opens = 0;
  let watching = false;
  const forwarders = new Map<string, (e: MessageEvent) => void>();

  function forwarder(name: string): (e: MessageEvent) => void {
    let fn = forwarders.get(name);
    if (!fn) {
      fn = (e: MessageEvent) => {
        const payload: unknown = JSON.parse(e.data as string);
        for (const handler of [...(handlers.get(name) ?? [])]) handler(name, payload);
      };
      forwarders.set(name, fn);
    }
    return fn;
  }

  const onOpen = () => {
    opens++;
    if (opens > 1) for (const fn of [...reconnects]) fn();
  };

  function start(): void {
    if (source || opts.isHidden()) return;
    source = opts.open();
    source.addEventListener('open', onOpen as (e: MessageEvent) => void);
    for (const name of handlers.keys()) source.addEventListener(name, forwarder(name));
  }

  function stop(): void {
    if (!source) return;
    source.removeEventListener('open', onOpen as (e: MessageEvent) => void);
    for (const [name, fn] of forwarders) source.removeEventListener(name, fn);
    source.close();
    source = null;
  }

  function watchVisibility(): void {
    if (watching) return;
    watching = true;
    opts.onVisibilityChange(() => (opts.isHidden() ? stop() : start()));
  }

  return {
    on(names: string[], handler: Handler): () => void {
      for (const name of names) {
        let set = handlers.get(name);
        if (!set) {
          set = new Set();
          handlers.set(name, set);
          source?.addEventListener(name, forwarder(name));
        }
        set.add(handler);
      }
      watchVisibility();
      start();
      return () => {
        for (const name of names) handlers.get(name)?.delete(handler);
      };
    },

    onReconnect(fn: () => void): () => void {
      reconnects.add(fn);
      return () => {
        reconnects.delete(fn);
      };
    },
  };
}
