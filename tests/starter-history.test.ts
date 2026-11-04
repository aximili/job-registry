// The app updates a starter guide you never changed, by knowing every earlier
// version. This checks that list against git, so a new version of a guide
// can't be committed without the one before it in the list. These checks only read.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GUIDE_NAMES, normaliseStarter, STARTER_HISTORY } from '../server/modules/profile/starters.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const hasGit = (() => {
  try {
    git('rev-parse', '--git-dir');
    return true;
  } catch {
    return false;
  }
})();
// A shallow clone lacks the old versions, so there's nothing to check against.
const shallow = hasGit && git('rev-parse', '--is-shallow-repository').trim() === 'true';
const sha256 = (text: string) => createHash('sha256').update(normaliseStarter(text)).digest('hex');

describe.skipIf(!hasGit || shallow)('the starter history, checked against git (skipped without git, or on a shallow clone)', () => {
  it.each(GUIDE_NAMES)('holds every committed version of %s but the current one', (name) => {
    const path = `starters/profile/${name}.md`;
    const current = sha256(readFileSync(join(root, path), 'utf8'));
    const commits = git('log', '--format=%H', '--', path).split('\n').filter(Boolean);
    expect(commits.length).toBeGreaterThanOrEqual(3);
    const earlier = new Set(commits.map((sha) => sha256(git('show', `${sha}:${path}`))).filter((hash) => hash !== current));
    expect(new Set(STARTER_HISTORY[name])).toEqual(earlier);
    expect(STARTER_HISTORY[name]).not.toContain(current);
  });
});

describe('the starter history', () => {
  it('holds full SHA-256 hashes, each once', () => {
    for (const name of GUIDE_NAMES) {
      for (const hash of STARTER_HISTORY[name]) expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(new Set(STARTER_HISTORY[name]).size).toBe(STARTER_HISTORY[name].length);
    }
  });
});
