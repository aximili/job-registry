import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from './logger.ts';
import { clearStartupError, installProcessHandlers, writeStartupError } from './process.ts';

function fakeProcess() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { exit: vi.fn() });
}
const fakeLogger = () => ({ fatal: vi.fn(), error: vi.fn(), info: vi.fn() }) as unknown as Logger & { fatal: ReturnType<typeof vi.fn> };

describe('process handlers', () => {
  it('stops cleanly on Ctrl+C, on stop requests and when the Windows console window closes', () => {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
      const proc = fakeProcess();
      const stop = vi.fn();
      installProcessHandlers(proc, { stop, logger: fakeLogger() });
      proc.emit(signal);
      expect(stop, signal).toHaveBeenCalledTimes(1);
    }
  });

  it('logs a crash to the log file and exits with code 1', () => {
    const proc = fakeProcess();
    const logger = fakeLogger();
    installProcessHandlers(proc, { stop: vi.fn(), logger });
    proc.emit('uncaughtException', new Error('boom'));
    proc.emit('unhandledRejection', new Error('later'));
    expect(logger.fatal).toHaveBeenCalledTimes(2);
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it('a crash ends the AI program first, so it never outlives the app holding GPU memory', () => {
    const proc = fakeProcess();
    const order: string[] = [];
    proc.exit.mockImplementation(() => order.push('exit'));
    installProcessHandlers(proc, { stop: vi.fn(), logger: fakeLogger(), onExit: () => order.push('ai stopped') });
    proc.emit('uncaughtException', new Error('boom'));
    expect(order).toEqual(['ai stopped', 'exit']);
  });

  it('any exit ends the AI program too', () => {
    const proc = fakeProcess();
    const onExit = vi.fn();
    installProcessHandlers(proc, { stop: vi.fn(), logger: fakeLogger(), onExit });
    proc.emit('exit', 0);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('start-up error file', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('writes a plain-text message that start.bat can show, and clears it on a good start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jr-proc-'));
    dirs.push(dir);
    const logs = join(dir, 'logs');
    writeStartupError(logs, 'C:\\jr\\config\\settings.json isn\'t valid JSON: Unexpected token');
    expect(readFileSync(join(logs, 'startup-error.txt'), 'utf8')).toBe(
      "C:\\jr\\config\\settings.json isn't valid JSON: Unexpected token\n",
    );
    clearStartupError(logs);
    expect(existsSync(join(logs, 'startup-error.txt'))).toBe(false);
  });
});

describe('start-up error file', () => {
  it('is plain ASCII, so cmd.exe shows it without garbled characters', () => {
    const logs = mkdtempSync(join(tmpdir(), 'jr-startup-'));
    try {
      writeStartupError(logs, 'C:\\Users\\Zoë\\settings.json has a problem:\n✖ Too short → at statuses[3].label — “Applied” …');
      const bytes = readFileSync(join(logs, 'startup-error.txt'));
      expect([...bytes].every((b) => b < 128)).toBe(true);
      expect(bytes.toString('ascii')).toBe(
        'C:\\Users\\Zoe\\settings.json has a problem:\n- Too short -> at statuses[3].label - "Applied" ...\n',
      );
    } finally {
      rmSync(logs, { recursive: true, force: true });
    }
  });
});

