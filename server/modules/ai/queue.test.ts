import { describe, expect, it } from 'vitest';
import { ReplacedError } from '../../core/errors.ts';
import { createAiQueue, type Priority } from './queue.ts';

// A task that waits until released, so tests control the order.
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { open, opened };
}

describe('AI queue', () => {
  it('runs one task at a time', async () => {
    const queue = createAiQueue();
    let running = 0;
    let most = 0;
    const work = async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
    };
    await Promise.all([1, 2, 3].map(() => queue.run({ priority: 'parse', work })));
    expect(most).toBe(1);
  });

  it("an interactive task jumps ahead of waiting parse and background tasks, but doesn't stop the running one", async () => {
    const queue = createAiQueue();
    const order: string[] = [];
    const first = gate();
    const add = (name: string, priority: Priority, wait?: Promise<void>) =>
      queue.run({
        priority,
        work: async () => {
          order.push(name);
          await wait;
        },
      });
    const all = [add('running parse', 'parse', first.opened), add('background', 'background'), add('parse', 'parse'), add('interactive', 'interactive')];
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['running parse']);
    first.open();
    await Promise.all(all);
    expect(order).toEqual(['running parse', 'interactive', 'parse', 'background']);
  });

  it('list runs after interactive and before parse and background', async () => {
    const queue = createAiQueue();
    const order: string[] = [];
    const first = gate();
    const add = (name: string, priority: Priority, wait?: Promise<void>) =>
      queue.run({
        priority,
        work: async () => {
          order.push(name);
          await wait;
        },
      });
    const all = [
      add('running', 'parse', first.opened),
      add('background', 'background'),
      add('parse', 'parse'),
      add('list', 'list'),
      add('interactive', 'interactive'),
    ];
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['running']);
    first.open();
    await Promise.all(all);
    expect(order).toEqual(['running', 'interactive', 'list', 'parse', 'background']);
  });

  it('parse goes before background, and each priority keeps its arrival order', async () => {
    const queue = createAiQueue();
    const order: string[] = [];
    const first = gate();
    const add = (name: string, priority: Priority, wait?: Promise<void>) =>
      queue.run({
        priority,
        work: async () => {
          order.push(name);
          await wait;
        },
      });
    const all = [add('busy', 'interactive', first.opened), add('old 1', 'background'), add('old 2', 'background'), add('new', 'parse')];
    first.open();
    await Promise.all(all);
    expect(order).toEqual(['busy', 'new', 'old 1', 'old 2']);
  });

  it('a new task with the same key cancels the older one, waiting or running', async () => {
    const queue = createAiQueue();
    const blocker = gate();
    const blocking = queue.run({ priority: 'parse', work: () => blocker.opened });
    const waiting = queue.run({ priority: 'interactive', key: 'tab-7', work: async () => 'A' });
    const newer = queue.run({ priority: 'interactive', key: 'tab-7', work: async () => 'B' });
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError', message: 'The AI task was cancelled.' });
    blocker.open();
    await blocking;
    expect(await newer).toBe('B');

    let sawAbort = false;
    const running = queue.run({
      priority: 'interactive',
      key: 'tab-8',
      work: (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => {
            sawAbort = true;
            reject(signal.reason);
          }),
        ),
    });
    await new Promise((r) => setTimeout(r, 5));
    const replacement = queue.run({ priority: 'interactive', key: 'tab-8', work: async () => 'C' });
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(sawAbort).toBe(true);
    expect(await replacement).toBe('C');
  });

  it('cancelKey cancels a waiting or running task with that key, and the others carry on', async () => {
    const queue = createAiQueue();
    let sawAbort = false;
    const running = queue.run({
      priority: 'interactive',
      key: 'doc-1-resume',
      work: (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => {
            sawAbort = true;
            reject(signal.reason);
          }),
        ),
    });
    let ran = false;
    const waiting = queue.run({ priority: 'interactive', key: 'doc-2-resume', work: async () => void (ran = true) });
    const other = queue.run({ priority: 'interactive', key: 'tab-7', work: async () => 'other' });
    const plain = queue.run({ priority: 'parse', work: async () => 'plain' });
    await new Promise((r) => setTimeout(r, 5));
    queue.cancelKey('doc-2-resume');
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError', message: 'The AI task was cancelled.' });
    expect(sawAbort).toBe(false);
    queue.cancelKey('doc-1-resume');
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(sawAbort).toBe(true);
    expect(await other).toBe('other');
    expect(await plain).toBe('plain');
    expect(ran).toBe(false);
    // A key with no task is nothing to cancel.
    queue.cancelKey('doc-3-resume');
    await queue.onIdle();
  });

  // So a stream still being read can say a newer one took its place, and
  // say nothing when it was stopped.
  it('a task replaced by a newer one with its key is cancelled as replaced; one stopped any other way is not', async () => {
    const queue = createAiQueue();
    const blocker = gate();
    const blocking = queue.run({ priority: 'parse', work: () => blocker.opened });
    const replaced = queue.run({ priority: 'interactive', key: 'brief-1', work: async () => 'A' });
    const newer = queue.run({ priority: 'interactive', key: 'brief-1', work: async () => 'B' });
    const err = await replaced.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReplacedError);
    // Still a cancel, as before.
    expect(err).toMatchObject({ name: 'AbortError', message: 'The AI task was cancelled.' });
    const byKey = queue.run({ priority: 'interactive', key: 'brief-2', work: async () => 'C' });
    queue.cancelKey('brief-2');
    expect(await byKey.catch((e: unknown) => e)).toBeInstanceOf(ReplacedError);

    const controller = new AbortController();
    const aborted = queue.run({ priority: 'interactive', signal: controller.signal, work: async () => 'D' });
    controller.abort();
    const stopped = queue.run({ priority: 'interactive', key: 'brief-3', work: async () => 'E' });
    queue.cancelAll();
    for (const task of [aborted, stopped, newer]) {
      const cancelled = await task.catch((e: unknown) => e);
      expect(cancelled).toMatchObject({ name: 'AbortError' });
      expect(cancelled).not.toBeInstanceOf(ReplacedError);
    }
    blocker.open();
    await blocking.catch(() => {});
  });

  it('aborting removes a waiting task, and aborts a running one', async () => {
    const queue = createAiQueue();
    const blocker = gate();
    const controller = new AbortController();
    let ran = false;
    const blocking = queue.run({
      priority: 'parse',
      signal: controller.signal,
      work: (signal) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
        void blocker.opened.then(resolve);
      }),
    });
    const second = new AbortController();
    const waiting = queue.run({ priority: 'parse', signal: second.signal, work: async () => void (ran = true) });
    second.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await expect(blocking).rejects.toMatchObject({ name: 'AbortError' });
    await queue.onIdle();
    expect(ran).toBe(false);
    expect(queue.pending()).toBe(0);
  });

  it("a failing task doesn't stop the next one", async () => {
    const queue = createAiQueue();
    const bad = queue.run({ priority: 'parse', work: async () => Promise.reject(new Error('boom')) });
    const good = queue.run({ priority: 'parse', work: async () => 'fine' });
    await expect(bad).rejects.toThrow('boom');
    expect(await good).toBe('fine');
    expect(queue.running()).toBe(false);
  });

  it('cancelAll cancels the running task and every waiting one, for a clean shutdown', async () => {
    const queue = createAiQueue();
    const running = queue.run({
      priority: 'parse',
      work: (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    });
    const waiting = queue.run({ priority: 'background', work: async () => 'never' });
    queue.cancelAll();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await queue.onIdle();
  });
});

