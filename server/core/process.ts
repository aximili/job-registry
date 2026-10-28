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

export function installProcessHandlers(proc: ProcessLike, opts: { stop: () => unknown; logger: Logger }): void {
  for (const signal of STOP_SIGNALS) proc.on(signal, () => void opts.stop());

  // A crash after start-up must reach the log file: the console window
  // closes with the process, taking its last words with it.
  const crash = (err: unknown) => {
    opts.logger.fatal({ err }, 'Job Registry stopped because of an unexpected error');
    proc.exit(1);
  };
  proc.on('uncaughtException', crash);
  proc.on('unhandledRejection', crash);
}

const STARTUP_ERROR = 'startup-error.txt';

// A plain sentence that start.bat shows when the app can't start.
export function writeStartupError(logsDir: string, message: string): void {
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(join(logsDir, STARTUP_ERROR), `${message}\n`);
}

export function clearStartupError(logsDir: string): void {
  rmSync(join(logsDir, STARTUP_ERROR), { force: true });
}
