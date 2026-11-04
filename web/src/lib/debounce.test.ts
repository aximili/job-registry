import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounceLatest } from './debounce.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('debounceLatest', () => {
  it('runs once, with the last value, when the changes stop', async () => {
    const runs: string[] = [];
    const save = debounceLatest(async (v: string) => void runs.push(v), 400);
    save('bonsai-2b-light');
    await vi.advanceTimersByTimeAsync(100);
    save('claude-mine');
    await vi.advanceTimersByTimeAsync(399);
    expect(runs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toEqual(['claude-mine']);
  });

  it('runs each change that comes after a pause, in order', async () => {
    const runs: string[] = [];
    const save = debounceLatest(async (v: string) => void runs.push(v), 400);
    save('a');
    await vi.advanceTimersByTimeAsync(400);
    save('b');
    await vi.advanceTimersByTimeAsync(400);
    expect(runs).toEqual(['a', 'b']);
  });

  it('never runs two at once: a later one waits for the one running', async () => {
    const log: string[] = [];
    let finish = () => {};
    const save = debounceLatest(async (v: string) => {
      log.push(`start ${v}`);
      if (v === 'a') await new Promise<void>((done) => (finish = done));
      log.push(`end ${v}`);
    }, 400);
    save('a');
    await vi.advanceTimersByTimeAsync(400);
    save('b');
    await vi.advanceTimersByTimeAsync(400);
    expect(log).toEqual(['start a']);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('a run that fails does not stop the next one', async () => {
    const runs: string[] = [];
    const save = debounceLatest(async (v: string) => {
      runs.push(v);
      if (v === 'a') throw new Error('refused');
    }, 400);
    save('a');
    await vi.advanceTimersByTimeAsync(400);
    save('b');
    await vi.advanceTimersByTimeAsync(400);
    expect(runs).toEqual(['a', 'b']);
  });
});

describe('debounceLatest, flushed', () => {
  it('runs a waiting change at once, and only once', async () => {
    const runs: string[] = [];
    const save = debounceLatest(async (v: string) => void runs.push(v), 400);
    save('claude-mine');
    save.flush();
    // At once, before any timer: a page that's going away has no time to wait.
    expect(runs).toEqual(['claude-mine']);
    await vi.advanceTimersByTimeAsync(400);
    expect(runs).toEqual(['claude-mine']);
  });

  it('does nothing with no change waiting', async () => {
    const runs: string[] = [];
    const save = debounceLatest(async (v: string) => void runs.push(v), 400);
    save.flush();
    save('a');
    await vi.advanceTimersByTimeAsync(400);
    save.flush();
    expect(runs).toEqual(['a']);
  });

  it('while a run is going, runs the waiting change straight after it', async () => {
    const log: string[] = [];
    let finish = () => {};
    const save = debounceLatest(async (v: string) => {
      log.push(`start ${v}`);
      if (v === 'a') await new Promise<void>((done) => (finish = done));
      log.push(`end ${v}`);
    }, 400);
    save('a');
    await vi.advanceTimersByTimeAsync(400);
    save('b');
    save.flush();
    expect(log).toEqual(['start a']);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});

describe('debounceLatest, settled', () => {
  it('runs a waiting change at once, and resolves once every run has ended', async () => {
    const log: string[] = [];
    let finish = () => {};
    const save = debounceLatest(async (v: string) => {
      log.push(`start ${v}`);
      if (v === 'a') await new Promise<void>((done) => (finish = done));
      log.push(`end ${v}`);
    }, 400);
    save('a');
    await vi.advanceTimersByTimeAsync(400);
    save('b');
    let settled = false;
    void save.settled().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
    expect(settled).toBe(true);
  });

  it('resolves at once with nothing waiting or running', async () => {
    const save = debounceLatest(async () => {}, 400);
    let settled = false;
    void save.settled().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });

  it('resolves after a run that fails', async () => {
    const save = debounceLatest(async () => {
      throw new Error('refused');
    }, 400);
    save('a');
    let settled = false;
    void save.settled().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });
});
