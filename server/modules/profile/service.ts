// Your profile files in profile/: the master profile (everything you've done)
// and your preferences (roles, salary floor, locations, deal-breakers). They're
// plain Markdown you can edit in any text editor. Phase 4 adds the editors.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ProfileName = 'master-profile' | 'preferences';

export interface ProfileService {
  // The file's text, or null when it's missing or blank.
  read(name: ProfileName): string | null;
  // Changes whenever either file changes, so old ratings can be told apart.
  hash(): string;
}

export function createProfileService(opts: { dir: string }): ProfileService {
  function read(name: ProfileName): string | null {
    const file = join(opts.dir, `${name}.md`);
    if (!existsSync(file)) return null;
    const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return text.trim() ? text : null;
  }

  return {
    read,
    hash() {
      const text = `${read('master-profile') ?? ''}\n---\n${read('preferences') ?? ''}`;
      return createHash('sha256').update(text).digest('hex').slice(0, 16);
    },
  };
}
