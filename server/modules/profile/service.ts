// Your profile files and document templates. The Markdown files live in
// profile/: the master profile (everything you've done), your preferences
// (roles, salary floor, locations, deal-breakers) and the two writing guides.
// The CSS templates for resumes and cover letters live in templates/. They're
// plain files you can edit in Settings or in any text editor.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ProfileFile, ProfileFileName } from '../../../shared/contracts/index.ts';
import type { Clock } from '../../core/config.ts';
import type { EventBus } from '../../core/events.ts';
import { replaceFile } from '../../core/files.ts';

export type { ProfileFileName };

export interface ProfileService {
  // The file's text, or null when it's missing or blank.
  read(name: ProfileFileName): string | null;
  // The file for the editors: empty text and no date when it's missing.
  file(name: ProfileFileName): ProfileFile;
  write(name: ProfileFileName, text: string): ProfileFile;
  // Changes whenever the master profile or preferences change, so old ratings can be told apart.
  hash(): string;
  // Copies a starter guide or template in wherever one is missing. Returns the names copied.
  installStarters(): ProfileFileName[];
}

export type ProfileOptions = {
  dir: string;
  templatesDir: string;
  startersDir: string;
  bus: EventBus;
  now: Clock;
};

const TEMPLATES: readonly ProfileFileName[] = ['resume', 'cover-letter'];
// No starter master profile or preferences: they'd be rated as if they were yours.
const STARTERS: readonly ProfileFileName[] = ['resume-guide', 'cover-letter-guide', 'resume', 'cover-letter'];

export function createProfileService(opts: ProfileOptions): ProfileService {
  const pathOf = (name: ProfileFileName): string =>
    TEMPLATES.includes(name) ? join(opts.templatesDir, `${name}.css`) : join(opts.dir, `${name}.md`);
  const starterOf = (name: ProfileFileName): string =>
    TEMPLATES.includes(name) ? join(opts.startersDir, 'templates', `${name}.css`) : join(opts.startersDir, 'profile', `${name}.md`);

  function rawText(name: ProfileFileName): string | null {
    const file = pathOf(name);
    if (!existsSync(file)) return null;
    return readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  }

  function file(name: ProfileFileName): ProfileFile {
    const path = pathOf(name);
    if (!existsSync(path)) return { name, text: '', updatedAt: null };
    return { name, text: rawText(name) ?? '', updatedAt: statSync(path).mtime.toISOString() };
  }

  function read(name: ProfileFileName): string | null {
    const text = rawText(name);
    return text?.trim() ? text : null;
  }

  return {
    read,
    file,

    write(name, text) {
      const path = pathOf(name);
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${opts.now().getTime()}.tmp`;
      writeFileSync(tmp, text);
      replaceFile(tmp, path);
      opts.bus.emit('profile.changed', { name });
      return file(name);
    },

    hash() {
      const text = `${read('master-profile') ?? ''}\n---\n${read('preferences') ?? ''}`;
      return createHash('sha256').update(text).digest('hex').slice(0, 16);
    },

    installStarters() {
      const copied: ProfileFileName[] = [];
      for (const name of STARTERS) {
        const to = pathOf(name);
        const from = starterOf(name);
        if (existsSync(to) || !existsSync(from)) continue;
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
        copied.push(name);
      }
      return copied;
    },
  };
}
