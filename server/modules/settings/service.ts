// Owns config/settings.json and config/secrets.json. You can also edit them
// by hand, so a mistake in one stops with a clear message, and a file is
// never overwritten with a guess. Secrets never leave this module except
// through emailPassword() and aiKey(), which only app.ts uses.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  AiId,
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
  // Checked here, so a field with a default may be left out. A change to the
  // AIs that leaves the writing AI out keeps the saved one.
  update(patch: z.input<typeof UpdateSettingsRequest>): Settings;
  // Switch the AI the whole app uses to another saved one.
  useAi(id: string): Settings;
  // Pick the saved AI that writes your documents, or null for the AI in use.
  useWriter(id: string | null): Settings;
  statuses(): Status[];
  // Whether each secret is set. The secrets themselves are never sent out.
  secrets(): SecretsStatus;
  emailPassword(): string | null;
  // One saved AI's API key, for its own provider only.
  aiKey(id: string): string | null;
  updateSecrets(req: UpdateSecretsRequest): SecretsStatus;
}

const Secrets = z.strictObject({
  emailPassword: z.string().nullable().default(null),
  // API keys by AI id.
  aiKeys: z.record(AiId, z.string()).default({}),
});
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
  const savedIds = (settings: Settings) => new Set(settings.ai.saved.map((ai) => ai.id));
  const presetsById = (settings: Settings) => new Map(settings.ai.saved.map((ai) => [ai.id, ai.preset]));
  // Keys are for the saved AIs the app knows: the ones GET /settings gives.
  // A key left behind by a hand edit isn't listed.
  const status = (secrets: Secrets): SecretsStatus => {
    const saved = savedIds(current);
    return {
      emailPassword: secrets.emailPassword !== null,
      aiKeys: Object.keys(secrets.aiKeys).filter((id) => saved.has(id) && keyOf(secrets, id) !== null),
    };
  };

  return {
    get: () => current,

    update(patch) {
      const parsed = UpdateSettingsRequest.safeParse(patch);
      if (!parsed.success) throw new ValidationError(z.prettifyError(parsed.error));
      // The app runs all day, so you may have edited the file by hand since it started.
      // Start from what's on disk, not from memory, so those edits survive.
      current = load(opts.file);
      const changes = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
      // A change to the AIs that leaves the writer out keeps the saved one.
      if (parsed.data.ai && parsed.data.ai.writer === undefined) changes.ai = { ...parsed.data.ai, writer: current.ai.writer };
      const next = Settings.safeParse({ ...current, ...changes });
      if (!next.success) throw new ValidationError(z.prettifyError(next.error));
      // Read before anything is written, so a broken secrets file stops the save.
      const secrets = parsed.data.ai ? loadSecrets(secretsFile) : null;
      const before = current;
      const saving = withKnownWriter(next.data);
      write(opts.file, saving);
      current = saving;
      if (secrets) {
        // A key stays only while its AI stays saved, with the same provider.
        // A deleted AI's key goes, so a new AI that gets the same id never
        // gets the old key. A key for an AI whose provider changed goes too,
        // so a key only ever goes to the provider it was saved for. No event
        // for it: the AI reads its key each time.
        const was = presetsById(before);
        const still = presetsById(current);
        const aiKeys = Object.fromEntries(
          Object.entries(secrets.aiKeys).filter(([id]) => was.has(id) && still.has(id) && was.get(id) === still.get(id)),
        );
        if (Object.keys(aiKeys).length < Object.keys(secrets.aiKeys).length) writeJson(secretsFile, { ...secrets, aiKeys });
      }
      opts.bus.emit('settings.changed', { keys: Object.keys(changes) });
      return current;
    },

    useAi(id) {
      current = load(opts.file);
      if (!savedIds(current).has(id)) throw new ValidationError(`There's no saved AI with the id '${id}'.`);
      current = { ...current, ai: { ...current.ai, active: id } };
      write(opts.file, current);
      opts.bus.emit('settings.changed', { keys: ['ai'] });
      return current;
    },

    useWriter(id) {
      current = load(opts.file);
      // The id isn't quoted: it may be a key pasted in the wrong place, and some keys look like an id.
      if (id !== null && !savedIds(current).has(id)) throw new ValidationError("There's no saved AI with that id.");
      current = { ...current, ai: { ...current.ai, writer: id } };
      write(opts.file, current);
      opts.bus.emit('settings.changed', { keys: ['ai'] });
      return current;
    },

    statuses: () => [...current.statuses].sort((a, b) => a.order - b.order),

    // Read from disk each time, so a hand edit counts at once.
    secrets: () => status(loadSecrets(secretsFile)),
    emailPassword: () => loadSecrets(secretsFile).emailPassword,
    aiKey: (id) => keyOf(loadSecrets(secretsFile), id),

    updateSecrets(req) {
      const parsed = UpdateSecretsRequest.safeParse(req);
      if (!parsed.success) throw new ValidationError(secretsRequestProblem(parsed.error));
      const { emailPassword, aiKeys } = parsed.data;
      const before: Secrets = loadSecrets(secretsFile);
      const next: Secrets = { ...before, aiKeys: { ...before.aiKeys } };
      // Google shows an app password in groups of four letters; the spaces aren't part of it.
      if (emailPassword !== undefined) next.emailPassword = emailPassword?.replace(/\s+/g, '') || null;
      if (aiKeys) {
        const saved = savedIds(current);
        for (const [id, value] of Object.entries(aiKeys)) {
          // A pasted key can bring spaces or a newline with it. No key has any.
          const key = value?.replace(/\s+/g, '') || null;
          if (key === null) delete next.aiKeys[id];
          // Only for a saved AI, so a key can never wait for an AI that gets this id later.
          else if (saved.has(id)) next.aiKeys[id] = key;
          // The id isn't quoted: it may be a key pasted in the wrong place.
          else throw new ValidationError("There's no saved AI for this key. Save the AI first, then its key.");
        }
      }
      writeJson(secretsFile, next);
      // Only what really changed, and never the secrets themselves. Gmail
      // listens for "secrets" and restarts its timer each time, so it hears
      // only of a new app password. The AI listens for "aiKeys": a new key
      // may fix the problem the AI pill shows.
      const changed: string[] = [];
      if (next.emailPassword !== before.emailPassword) changed.push('secrets');
      if (aiKeys && Object.keys(aiKeys).some((id) => keyOf(before, id) !== keyOf(next, id))) changed.push('aiKeys');
      if (changed.length > 0) opts.bus.emit('settings.changed', { keys: changed });
      return status(next);
    },
  };
}

// Why a request to change the secrets was refused. zod's own message quotes
// the names it got, and a name under "aiKeys" may be a pasted key, so this
// never repeats one.
export function secretsRequestProblem(error: z.core.$ZodError): string {
  if (error.issues.some((issue) => issue.code === 'invalid_key')) return "An API key was sent for an AI id that isn't valid.";
  if (error.issues.some((issue) => issue.path[0] === 'aiKeys')) return 'Send each API key as text under its AI id, or null to remove it.';
  if (error.issues.some((issue) => issue.path[0] === 'emailPassword')) return 'Send the app password as text, or null to remove it.';
  return 'Only "emailPassword" and "aiKeys" can be sent.';
}

// The settings as saved: a writing AI that isn't saved after this save
// becomes none (the AI in use), as a deleted AI's key goes. So a new AI that
// gets the same id later never writes your documents by accident.
function withKnownWriter(settings: Settings): Settings {
  const { writer, saved } = settings.ai;
  if (writer === null || saved.some((one) => one.id === writer)) return settings;
  return { ...settings, ai: { ...settings.ai, writer: null } };
}

// One AI's key, as sent: a hand-edited file may have spaces or a newline in it.
function keyOf(secrets: Secrets, id: string): string | null {
  return (Object.hasOwn(secrets.aiKeys, id) && secrets.aiKeys[id]?.replace(/\s+/g, '')) || null;
}

function loadSecrets(file: string): Secrets {
  if (!existsSync(file)) return Secrets.parse({});
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // JSON.parse quotes the text near the mistake, which may be the password or a key.
    throw new ValidationError(`${file} isn't valid JSON. Check the quotes around the password and API keys.`);
  }
  const result = Secrets.safeParse(raw);
  if (!result.success) {
    // zod quotes a name it didn't expect, and a path can hold an AI id that
    // is really a pasted key. So this names only the section with the mistake.
    const where = (issue: z.core.$ZodIssue) =>
      issue.code === 'unrecognized_keys' ? "a name it doesn't know" : issue.path.length > 0 ? `"${String(issue.path[0])}"` : 'its shape';
    const sections = [...new Set(result.error.issues.map(where))];
    throw new ValidationError(
      `${file} has a problem in ${sections.join(' and ')}. It holds "emailPassword" (text or null) and "aiKeys" (each AI id with its key, as text).`,
    );
  }
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
