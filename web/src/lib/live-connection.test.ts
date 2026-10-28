import { describe, expect, it } from 'vitest';
import { createLiveConnection, type EventSourceLike } from './live-connection.ts';

class FakeSource implements EventSourceLike {
  static made: FakeSource[] = [];
  listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  closed = false;
  constructor() {
    FakeSource.made.push(this);
  }
  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
  }
  removeEventListener(name: string, fn: (e: MessageEvent) => void) {
    this.listeners.get(name)?.delete(fn);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, data: unknown = {}) {
    for (const fn of this.listeners.get(name) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function setup() {
  FakeSource.made = [];
  let hidden = false;
  let onChange = () => {};
  const live = createLiveConnection({
    open: () => new FakeSource(),
    isHidden: () => hidden,
    onVisibilityChange: (fn) => {
      onChange = fn;
      return () => {};
    },
  });
  return {
    live,
    hide: () => ((hidden = true), onChange()),
    show: () => ((hidden = false), onChange()),
    current: () => FakeSource.made.at(-1)!,
  };
}

describe('live connection', () => {
  it('closes the stream while the tab is hidden, and opens a new one when shown, keeping the handlers', () => {
    const { live, hide, show, current } = setup();
    const seen: string[] = [];
    live.on(['job.updated'], (name) => seen.push(name));
    const first = current();
    hide();
    expect(first.closed).toBe(true);
    show();
    expect(FakeSource.made).toHaveLength(2);
    current().emit('job.updated', { jobId: 1 });
    first.emit('job.updated', { jobId: 1 });
    expect(seen).toEqual(['job.updated']);
  });

  it('tells pages to reload after it reopens or the stream reconnects, but not on the first open', () => {
    const { live, hide, show, current } = setup();
    let reloads = 0;
    live.onReconnect(() => reloads++);
    live.on(['job.updated'], () => {});
    current().emit('open');
    expect(reloads).toBe(0);
    current().emit('open'); // the browser reconnected by itself, say after the server restarted
    expect(reloads).toBe(1);
    hide();
    show();
    current().emit('open');
    expect(reloads).toBe(2);
  });

  it('stops listening when a page unsubscribes', () => {
    const { live, current } = setup();
    const seen: string[] = [];
    const off = live.on(['job.updated'], (name) => seen.push(name));
    off();
    current().emit('job.updated');
    expect(seen).toEqual([]);
  });
});
