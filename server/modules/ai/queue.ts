// One AI task at a time, because there's one GPU. Waiting tasks start by
// priority: you waiting on a rating first, then quick marks on the search
// list you're looking at, then reading saved ads, then background work.
// A running task is never interrupted for a higher one.
// See docs/architecture.md §12.3.

export type Priority = 'interactive' | 'list' | 'parse' | 'background';

const RANK: Record<Priority, number> = { interactive: 0, list: 1, parse: 2, background: 3 };

export type QueueTask<T> = {
  priority: Priority;
  // "Latest wins": a new task with the same key cancels the older one.
  key?: string;
  signal?: AbortSignal;
  work: (signal: AbortSignal) => Promise<T>;
};

type Entry = {
  priority: Priority;
  key?: string;
  seq: number;
  controller: AbortController;
  start: () => Promise<void>;
  cancel: () => void;
};

export interface AiQueue {
  run<T>(task: QueueTask<T>): Promise<T>;
  pending(): number;
  running(): boolean;
  onIdle(): Promise<void>;
  // Cancels everything: the running task and every waiting one.
  cancelAll(): void;
}

const cancelled = () => new DOMException('The AI task was cancelled.', 'AbortError');

export function createAiQueue(): AiQueue {
  const waiting: Entry[] = [];
  let current: Entry | null = null;
  let seq = 0;
  const idleWaiters: (() => void)[] = [];

  function next(): void {
    if (current) return;
    waiting.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.seq - b.seq);
    const entry = waiting.shift();
    if (!entry) {
      for (const done of idleWaiters.splice(0)) done();
      return;
    }
    current = entry;
    void entry.start().finally(() => {
      current = null;
      next();
    });
  }

  return {
    run<T>(task: QueueTask<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (task.signal?.aborted) return reject(cancelled());
        const controller = new AbortController();

        if (task.key !== undefined) {
          for (const other of [...waiting, ...(current ? [current] : [])]) {
            if (other.key === task.key) other.cancel();
          }
        }

        let settled = false;
        const entry: Entry = {
          priority: task.priority,
          key: task.key,
          seq: seq++,
          controller,
          async start() {
            if (settled) return;
            try {
              const value = await task.work(controller.signal);
              if (!settled) {
                settled = true;
                resolve(value);
              }
            } catch (err) {
              if (!settled) {
                settled = true;
                reject(controller.signal.aborted ? cancelled() : err);
              }
            }
          },
          cancel() {
            const at = waiting.indexOf(entry);
            if (at !== -1) waiting.splice(at, 1);
            controller.abort(cancelled());
            if (!settled) {
              settled = true;
              reject(cancelled());
            }
          },
        };
        task.signal?.addEventListener('abort', () => entry.cancel(), { once: true });
        waiting.push(entry);
        next();
      });
    },

    cancelAll() {
      for (const entry of [...waiting, ...(current ? [current] : [])]) entry.cancel();
    },

    pending: () => waiting.length,
    running: () => current !== null,
    onIdle() {
      if (!current && waiting.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}
