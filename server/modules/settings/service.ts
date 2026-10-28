// Owns config/settings.json. You can also edit that file by hand, so a mistake
// in it stops the app with a clear message, and the file is never overwritten.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { Settings, UpdateSettingsRequest, type Status } from '../../../shared/contracts/index.ts';
import { ValidationError } from '../../core/errors.ts';
import type { EventBus } from '../../core/events.ts';
import { replaceFile } from '../../core/files.ts';

export interface SettingsService {
  get(): Settings;
  update(patch: UpdateSettingsRequest): Settings;
  statuses(): Status[];
}

export function createSettingsService(opts: { file: string; bus: EventBus }): SettingsService {
  let current = load(opts.file);

  return {
    get: () => current,

    update(patch) {
      const parsed = UpdateSettingsRequest.safeParse(patch);
      if (!parsed.success) throw new ValidationError(z.prettifyError(parsed.error));
      // The app runs all day, so you may have edited the file by hand since it started.
      // Start from what's on disk, not from memory, so those edits survive.
      current = load(opts.file);
      const changes = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
      const next = Settings.safeParse({ ...current, ...changes });
      if (!next.success) throw new ValidationError(z.prettifyError(next.error));
      write(opts.file, next.data);
      current = next.data;
      opts.bus.emit('settings.changed', { keys: Object.keys(changes) });
      return current;
    },

    statuses: () => [...current.statuses].sort((a, b) => a.order - b.order),
  };
}

function load(file: string): Settings {
  if (!existsSync(file)) {
    const defaults = Settings.parse({});
    write(file, defaults);
    return defaults;
  }
  // Windows Notepad can save UTF-8 with a byte-order mark, which JSON.parse rejects.
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ValidationError(`${file} isn't valid JSON: ${(err as Error).message}`);
  }
  const result = Settings.safeParse(raw);
  if (!result.success) throw new ValidationError(`${file} has a problem:\n${z.prettifyError(result.error)}`);
  return result.data;
}

// Write to a temporary file, then rename it, so a crash never leaves half a file.
function write(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  replaceFile(tmp, file);
}
