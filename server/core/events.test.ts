import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from './events.ts';
import type { Logger } from './logger.ts';

function fakeLogger() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger & {
    error: ReturnType<typeof vi.fn>;
  };
}

describe('event bus', () => {
  it('runs handlers in order and keeps going when one throws', () => {
    const logger = fakeLogger();
    const bus = createEventBus(logger);
    const calls: string[] = [];
    bus.on('job.saved', () => {
      calls.push('first');
      throw new Error('boom');
    });
    bus.on('job.saved', ({ jobId }) => calls.push(`second ${jobId}`));
    bus.emit('job.saved', { jobId: 7 });
    expect(calls).toEqual(['first', 'second 7']);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('on() returns an unsubscribe function', () => {
    const bus = createEventBus(fakeLogger());
    const handler = vi.fn();
    const off = bus.on('note.added', handler);
    off();
    bus.emit('note.added', { jobId: 1, noteId: 2 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('onAny receives every event name and payload', () => {
    const bus = createEventBus(fakeLogger());
    const seen: unknown[] = [];
    bus.onAny((name, payload) => seen.push([name, payload]));
    bus.emit('job.saved', { jobId: 1 });
    bus.emit('settings.changed', { keys: ['statuses'] });
    expect(seen).toEqual([
      ['job.saved', { jobId: 1 }],
      ['settings.changed', { keys: ['statuses'] }],
    ]);
  });
});
