// Replacing a file safely. Writes go to a temporary file first, then a rename
// swaps it in, so a crash never leaves half a file.

import { renameSync } from 'node:fs';

// On Windows, antivirus and the search indexer briefly lock files they're
// scanning, and a rename then fails with one of these codes.
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);
const TRIES = 5;

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

export function replaceFile(
  tmp: string,
  file: string,
  io: { rename?: (from: string, to: string) => void; wait?: (ms: number) => void } = {},
): void {
  const rename = io.rename ?? renameSync;
  const wait = io.wait ?? sleep;
  for (let attempt = 1; ; attempt++) {
    try {
      rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!BUSY.has(code) || attempt === TRIES) throw err;
      wait(50 * attempt);
    }
  }
}
