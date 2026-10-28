// How the running app reacts to the outside world: being asked to stop,
// its window being closed, and crashing.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from './logger.ts';

type ProcessLike = {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  exit(code?: number): void;
};

// SIGHUP is what Windows sends when you close the server's console window,
// and SIGBREAK is Ctrl+Break. Both get the same clean stop as Ctrl+C, so the
// database is closed properly.
const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];

export function installProcessHandlers(
  proc: ProcessLike,
  opts: { stop: () => unknown; logger: Logger; onExit?: () => void },
): void {
  for (const signal of STOP_SIGNALS) proc.on(signal, () => void opts.stop());

  // onExit ends child processes, such as llama-server, at once, so a crash
  // never leaves one holding GPU memory. (Windows also ends them through
  // Node's job object; macOS and Linux don't.) It must be quick and
  // synchronous: there's no time to wait.
  const onExit = () => {
    try {
      opts.onExit?.();
    } catch (err) {
      opts.logger.error({ err }, 'Stopping the AI on exit failed');
    }
  };
  proc.on('exit', onExit);

  // A crash after start-up must reach the log file: the console window
  // closes with the process, taking its last words with it.
  const crash = (err: unknown) => {
    opts.logger.fatal({ err }, 'Job Registry stopped because of an unexpected error');
    onExit();
    proc.exit(1);
  };
  proc.on('uncaughtException', crash);
  proc.on('unhandledRejection', crash);
}

const STARTUP_ERROR = 'startup-error.txt';

// A plain sentence that start.bat shows when the app can't start.
export function writeStartupError(logsDir: string, message: string): void {
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(join(logsDir, STARTUP_ERROR), `${toAscii(message)}\n`, 'ascii');
}

// cmd.exe shows anything beyond plain ASCII as garbled characters, so the
// symbols in error messages become their nearest plain equivalents.
const ASCII_FOR: Record<string, string> = {
  '\u2716': '-', // the heavy cross that zod puts before each problem
  '\u2192': '->',
  '\u2013': '-',
  '\u2014': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u2026': '...',
  '\u00A0': ' ',
};

export function toAscii(text: string): string {
  return text
    .replace(/[\u2716\u2192\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u00A0]/g, (c) => ASCII_FOR[c]!)
    .normalize('NFKD') // é becomes e plus an accent, and the accent is dropped below
    .replace(/[^\x00-\x7F]/g, (c) => (/\p{M}/u.test(c) ? '' : '?'));
}

export function clearStartupError(logsDir: string): void {
  rmSync(join(logsDir, STARTUP_ERROR), { force: true });
}
