// Every earlier version of the two starter guides, so the app can tell a guide
// you never changed (safe to update at start-up) from one you did (left alone,
// with a note in Settings → Profile). tests/starter-history.test.ts checks this
// list against git: when a guide changes, add the old version's hash here.

import { createHash } from 'node:crypto';
import { GuideName } from '../../../shared/contracts/index.ts';
import { normaliseLines } from '../../../shared/line-diff.ts';

export const GUIDE_NAMES: readonly GuideName[] = GuideName.options;

// Git for Windows checks .md files out with Windows line endings, and some
// editors add a byte-order mark or drop the last line break. None of them
// counts as a change, here or in the diff Settings shows.
export function normaliseStarter(text: string): string {
  return normaliseLines(text);
}

// The SHA-256 of a guide's text, after normaliseStarter.
export function starterHash(text: string): string {
  return createHash('sha256').update(normaliseStarter(text)).digest('hex');
}

// Oldest first: commits 67c19c5, 5ac1b81 and 75011e0.
export const STARTER_HISTORY: Readonly<Record<GuideName, readonly string[]>> = {
  'resume-guide': [
    '70c7334d985f90762cb84411b166b7b0548444d03b38c8f0919306ec5cb95100',
    '46958faec47ce46c43fe1d37da11356fa19f31dc353000ec5873b241b568c4a6',
    '4a6a083b4014bc6af59efd4942525bd20a95f9e99a458bb5075b3f5ba480a31e',
  ],
  'cover-letter-guide': [
    '44078cba7e36b26bb74a26858bceb89c34615f106806a1b44486df965feae331',
    'f04e226b0ee20f4bfb89594a8fd9cd5b1caf8e282be224383a2697e3bb2c3f7b',
    '1120f99cf4dc597abca91da37fc7121e0430f36beb2f05579253964655bbf4cb',
  ],
};
