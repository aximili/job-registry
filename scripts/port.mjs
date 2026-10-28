// Prints the port Job Registry listens on, for start.bat, stop.bat and start.sh.
// Falls back to 4777 when there's no settings file yet.

import { readFileSync } from 'node:fs';

let port = 4777;
try {
  const text = readFileSync(new URL('../config/settings.json', import.meta.url), 'utf8').replace(/^\uFEFF/, '');
  const value = JSON.parse(text)?.server?.port;
  if (Number.isInteger(value)) port = value;
} catch {
  // No settings yet, or a broken file: the app itself will explain.
}
console.log(port);
