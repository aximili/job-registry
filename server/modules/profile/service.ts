// Your profile files and document templates. The Markdown files live in
// profile/: the master profile (everything you've done), your preferences
// (roles, salary floor, locations, deal-breakers) and the two writing guides.
// The CSS templates for resumes and cover letters live in templates/. They're
// plain files you can edit in Settings or in any text editor.
//
// Old text is never lost: before the app replaces a guide or adds to the
// master profile, it copies the file to profile/old-versions/.

import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import type { GuideName, ProfileFile, ProfileFileName, StarterStatus } from '../../../shared/contracts/index.ts';
import { localDate } from '../../../shared/dates.ts';
import { NO_PROFILE } from '../../../shared/labels.ts';
import { lineDiff } from '../../../shared/line-diff.ts';
import type { Clock } from '../../core/config.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.ts';
import type { EventBus } from '../../core/events.ts';
import { replaceFile } from '../../core/files.ts';
import { GUIDE_NAMES, normaliseStarter, STARTER_HISTORY, starterHash } from './starters.ts';

export type { ProfileFileName };

export interface ProfileService {
  // The file's text, or null when it's missing or blank.
  read(name: ProfileFileName): string | null;
  // The file for the editors: empty text and no date when it's missing.
  file(name: ProfileFileName): ProfileFile;
  // With updatedAt (the file's time when the editor loaded it, null for a
  // missing file), a file that has changed since isn't saved over: a
  // ConflictError. Without it, the text is saved as it is.
  write(name: ProfileFileName, text: string, o?: { updatedAt?: string | null }): ProfileFile;
  // Changes whenever the master profile or preferences change, so old ratings can be told apart.
  hash(): string;
  // At start-up: copies a starter guide or template in wherever one is
  // missing, and replaces a guide that's exactly an earlier starter (keeping
  // its old text), unless you've already seen the current one. Anything else
  // is left alone. It never throws: a file it can't copy or update is left
  // as it was, and listed in failed.
  syncStarters(): { copied: ProfileFileName[]; updated: ProfileFileName[]; failed: { name: ProfileFileName; err: unknown }[] };
  // Each guide against its starter, with the diff when a newer one is ready.
  starters(): StarterStatus[];
  // Use the new guide: your old text goes to old-versions first.
  useStarter(name: GuideName): ProfileFile;
  // Keep mine: no note until a newer starter comes.
  keepStarter(name: GuideName): StarterStatus;
  // Adds ready-made lines at the end of the master profile's
  // "## Answers from my applications", which is added the first time.
  appendAnswers(lines: string[]): ProfileFile;
  // The lines in that section that aren't blank, as they are now. None when
  // there's no section, or no master profile.
  answerLines(): string[];
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
const isGuide = (name: ProfileFileName): name is GuideName => (GUIDE_NAMES as readonly string[]).includes(name);

const CHANGED = 'This file changed since you opened it. Reload the page to see the new text, then make your change again.';

const ANSWERS_HEADING = '## Answers from my applications';
// Found loosely, as you might type it: # or ##, any spaces, any case.
const ANSWERS_LINE = /^[ \t]*#{1,2}[ \t]*answers from my applications[ \t]*$/i;
// A line that starts with # or ## ends a section; ### and below stay inside it.
const SECTION_START = /^[ \t]*#{1,2}(?!#)/;

const pad = (n: number): string => String(n).padStart(2, '0');
// Local time, YYYY-MM-DD-HHMMSS: no colons, so Windows takes it as a file name.
const stamp = (d: Date): string => `${localDate(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

export function createProfileService(opts: ProfileOptions): ProfileService {
  const pathOf = (name: ProfileFileName): string =>
    TEMPLATES.includes(name) ? join(opts.templatesDir, `${name}.css`) : join(opts.dir, `${name}.md`);
  const starterOf = (name: ProfileFileName): string =>
    TEMPLATES.includes(name) ? join(opts.startersDir, 'templates', `${name}.css`) : join(opts.startersDir, 'profile', `${name}.md`);
  // Which starter you've seen for each guide: { name: starter hash }.
  const seenFile = join(opts.dir, '.starter-versions.json');

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

  // Through a temporary file, so a crash never leaves half a file.
  function put(path: string, data: string | Buffer): void {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${opts.now().getTime()}.tmp`;
    writeFileSync(tmp, data);
    try {
      replaceFile(tmp, path);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
  }

  // Copies the file, as it is, to old-versions/<name>-<YYYY-MM-DD-HHMMSS>.md,
  // or -2, -3 … when that name is taken.
  function keepOldVersion(name: ProfileFileName): void {
    const from = pathOf(name);
    const dir = join(opts.dir, 'old-versions');
    const base = `${name}-${stamp(opts.now())}`;
    const ext = extname(from);
    let to = join(dir, `${base}${ext}`);
    for (let n = 2; existsSync(to); n++) to = join(dir, `${base}-${n}${ext}`);
    mkdirSync(dir, { recursive: true });
    // Never over an old version, even one that appeared just now.
    copyFileSync(from, to, constants.COPYFILE_EXCL);
  }

  // A missing or broken file reads as no record.
  function seen(): Partial<Record<GuideName, string>> {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(seenFile, 'utf8'));
    } catch {
      return {};
    }
    const record: Partial<Record<GuideName, string>> = {};
    if (data && typeof data === 'object') {
      for (const name of GUIDE_NAMES) {
        const hash = (data as Record<string, unknown>)[name];
        if (typeof hash === 'string') record[name] = hash;
      }
    }
    return record;
  }

  function markSeen(names: GuideName[]): void {
    const record = seen();
    const before = JSON.stringify(record);
    for (const name of names) {
      const starter = starterText(name);
      if (starter !== null) record[name] = starterHash(starter);
    }
    if (JSON.stringify(record) !== before) put(seenFile, `${JSON.stringify(record, null, 2)}\n`);
  }

  function starterText(name: ProfileFileName): string | null {
    const from = starterOf(name);
    return existsSync(from) ? readFileSync(from, 'utf8') : null;
  }

  // The starter file's own bytes.
  function putStarter(name: ProfileFileName): void {
    put(pathOf(name), readFileSync(starterOf(name)));
  }

  function status(name: GuideName): StarterStatus | null {
    const starter = starterText(name);
    if (starter === null) return null;
    const path = pathOf(name);
    // A missing guide is copied in at start-up, so this is rare. It counts as empty.
    const mine = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (existsSync(path) && normaliseStarter(mine) === normaliseStarter(starter)) return { name, state: 'same', diff: null };
    if (seen()[name] === starterHash(starter)) return { name, state: 'yours', diff: null };
    return { name, state: 'newer', diff: lineDiff(mine, starter) };
  }

  function starterOrThrow(name: GuideName): string {
    const starter = starterText(name);
    if (starter === null) throw new NotFoundError(`There's no starter guide called ${name}.`);
    return starter;
  }

  return {
    read,
    file,

    write(name, text, o = {}) {
      // Answers added, or a new starter guide, since the editor loaded it.
      if (o.updatedAt !== undefined && file(name).updatedAt !== o.updatedAt) throw new ConflictError(CHANGED);
      put(pathOf(name), text);
      opts.bus.emit('profile.changed', { name });
      return file(name);
    },

    hash() {
      const text = `${read('master-profile') ?? ''}\n---\n${read('preferences') ?? ''}`;
      return createHash('sha256').update(text).digest('hex').slice(0, 16);
    },

    syncStarters() {
      const copied: ProfileFileName[] = [];
      const updated: ProfileFileName[] = [];
      const failed: { name: ProfileFileName; err: unknown }[] = [];
      const current: GuideName[] = [];
      const record = seen();
      for (const name of STARTERS) {
        // Each file on its own: one that can't be copied or updated is left as
        // it was (Settings still offers the new guide), and the app starts.
        try {
          const starter = starterText(name);
          if (starter === null) continue;
          const path = pathOf(name);
          if (!existsSync(path)) {
            putStarter(name);
            copied.push(name);
            if (isGuide(name)) current.push(name);
            continue;
          }
          if (!isGuide(name)) continue;
          const mine = normaliseStarter(readFileSync(path, 'utf8'));
          if (mine === normaliseStarter(starter)) {
            current.push(name);
          } else if (STARTER_HISTORY[name].includes(starterHash(mine)) && record[name] !== starterHash(starter)) {
            // An earlier starter you never changed: safe to update. Once
            // you've seen the current starter, an earlier one is one you put
            // back yourself, so it stays.
            keepOldVersion(name);
            putStarter(name);
            updated.push(name);
            current.push(name);
          }
        } catch (err) {
          failed.push({ name, err });
        }
      }
      try {
        if (current.length > 0) markSeen(current);
      } catch {
        // Only a hint: without it, a guide you change later shows the note
        // once more. The next start tries again.
      }
      return { copied, updated, failed };
    },

    starters() {
      return GUIDE_NAMES.map(status).filter((s): s is StarterStatus => s !== null);
    },

    useStarter(name) {
      const starter = starterOrThrow(name);
      const path = pathOf(name);
      if (existsSync(path) && normaliseStarter(readFileSync(path, 'utf8')) !== normaliseStarter(starter)) keepOldVersion(name);
      putStarter(name);
      markSeen([name]);
      opts.bus.emit('profile.changed', { name });
      return file(name);
    },

    keepStarter(name) {
      starterOrThrow(name);
      markSeen([name]);
      return status(name)!;
    },

    appendAnswers(lines) {
      if (lines.length === 0) return file('master-profile');
      if (!read('master-profile')) throw new ValidationError(NO_PROFILE);
      const path = pathOf('master-profile');
      // As it is on disk: its byte-order mark and line endings stay.
      const text = readFileSync(path, 'utf8');
      const eol = /\r\n/.test(text.slice(0, text.indexOf('\n') + 1)) ? '\r\n' : '\n';
      // One line each, so an answer can never start a heading of its own.
      const added = lines.map((line) => line.replace(/[ \t]*[\r\n]+[ \t]*/g, ' '));
      keepOldVersion('master-profile');
      put(path, withAnswers(text, added, eol));
      opts.bus.emit('profile.changed', { name: 'master-profile' });
      return file('master-profile');
    },

    answerLines() {
      const text = read('master-profile');
      if (!text) return [];
      const parts = text.split(/(?<=\n)/);
      const section = answersSection(parts);
      return section ? parts.slice(section.heading + 1, section.last + 1).map(bare).filter((line) => line.trim()) : [];
    },
  };
}

// A line of the file without its line ending or byte-order mark.
const bare = (part: string) => part.replace(/\r?\n$/, '').replace(/^\uFEFF/, '');

// Where the answers section is, in the file's lines (each with its own line
// ending): its heading, and its last line that isn't blank (the heading
// itself when it has none). Null when there's no heading.
function answersSection(parts: string[]): { heading: number; last: number } | null {
  const heading = parts.findIndex((part) => ANSWERS_LINE.test(bare(part)));
  if (heading === -1) return null;
  let next = parts.findIndex((part, i) => i > heading && SECTION_START.test(bare(part)));
  if (next === -1) next = parts.length;
  let last = next - 1;
  while (last > heading && bare(parts[last]!).trim() === '') last--;
  return { heading, last };
}

// The text with the lines at the end of the answers section, or under a new
// heading at the end. Everything else stays exactly as it was.
function withAnswers(text: string, lines: string[], eol: string): string {
  // Each part keeps its own line ending.
  const parts = text.split(/(?<=\n)/);
  const section = answersSection(parts);
  if (!section) {
    const gap = /\n[ \t]*\r?\n$/.test(text) ? '' : text.endsWith('\n') ? eol : `${eol}${eol}`;
    return `${text}${gap}${ANSWERS_HEADING}${eol}${lines.join(eol)}${text.endsWith('\n') ? eol : ''}`;
  }
  // After the section's last line that isn't blank, so the blank lines before the next heading stay.
  const { last } = section;
  const at = parts.slice(0, last + 1).join('').length;
  const insert = parts[last]!.endsWith('\n') ? lines.map((line) => `${line}${eol}`).join('') : `${eol}${lines.join(eol)}`;
  return `${text.slice(0, at)}${insert}${text.slice(at)}`;
}
