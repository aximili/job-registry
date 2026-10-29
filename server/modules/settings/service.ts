// Owns config/settings.json and config/secrets.json. You can also edit them
// by hand, so a mistake in one stops with a clear message, and a file is
// never overwritten with a guess. Secrets never leave this module except
// through emailPassword(), which app.ts hands to the email module.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  Settings,
  UpdateSecretsRequest,
  UpdateSettingsRequest,
  type SecretsStatus,
  type Status,
} from '../../../shared/contracts/index.ts';
import { ValidationError } from '../../core/errors.ts';
import type { EventBus } from '../../core/events.ts';
import { replaceFile } from '../../core/files.ts';

export interface SettingsService {
  get(): Settings;
  update(patch: UpdateSettingsRequest): Settings;
  statuses(): Status[];
  // Whether each secret is set. The secrets themselves are never sent out.
  secrets(): SecretsStatus;
  emailPassword(): string | null;
  updateSecrets(req: UpdateSecretsRequest): SecretsStatus;
}

const Secrets = z.strictObject({ emailPassword: z.string().nullable().default(null) });
type Secrets = z.infer<typeof Secrets>;

export type SettingsOptions = {
  file: string;
  // Defaults to secrets.json next to settings.json.
  secretsFile?: string;
  bus: EventBus;
};

export function createSettingsService(opts: SettingsOptions): SettingsService {
  let current = load(opts.file);
  const secretsFile = opts.secretsFile ?? join(dirname(opts.file), 'secrets.json');
  const status = (secrets: Secrets): SecretsStatus => ({ emailPassword: secrets.emailPassword !== null });

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

    // Read from disk each time, so a hand edit counts at once.
    secrets: () => status(loadSecrets(secretsFile)),
    emailPassword: () => loadSecrets(secretsFile).emailPassword,

    updateSecrets(req) {
      const parsed = UpdateSecretsRequest.safeParse(req);
      if (!parsed.success) throw new ValidationError(z.prettifyError(parsed.error));
      // Google shows an app password in groups of four letters; the spaces aren't part of it.
      const password = parsed.data.emailPassword?.replace(/\s+/g, '') || null;
      const next: Secrets = { ...loadSecrets(secretsFile), emailPassword: password };
      writeJson(secretsFile, next);
      opts.bus.emit('settings.changed', { keys: ['secrets'] });
      return status(next);
    },
  };
}

function loadSecrets(file: string): Secrets {
  if (!existsSync(file)) return Secrets.parse({});
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // JSON.parse quotes the text near the mistake, which may be the password.
    throw new ValidationError(`${file} isn't valid JSON. Check the quotes around the password.`);
  }
  const result = Secrets.safeParse(raw);
  if (!result.success) throw new ValidationError(`${file} has a problem:\n${z.prettifyError(result.error)}`);
  return result.data;
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

function write(file: string, settings: Settings): void {
  writeJson(file, settings);
}

// Write to a temporary file, then rename it, so a crash never leaves half a file.
function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  replaceFile(tmp, file);
}
