// Turns any error into a sentence you can act on, without raw browser or
// validation-library wording.

import { ApiError } from '../../../shared/api-client.ts';

const CANT_REACH = "Can't reach Job Registry. Check that it's still running, then try again.";

export function friendlyError(err: unknown): string {
  // fetch throws a TypeError when the server can't be reached at all.
  if (err instanceof TypeError) return CANT_REACH;
  if (err instanceof ApiError) return tidy(err.message);
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong.';
}

// zod's messages look like "✖ A status needs a label.\n  → at statuses[3].label".
// Keep the sentences, drop the symbols and the "at …" lines.
function tidy(message: string): string {
  return message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('→'))
    .map((line) => line.replace(/^✖\s*/, ''))
    .join(' ');
}
