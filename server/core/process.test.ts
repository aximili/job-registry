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
