import { z } from 'zod';
import { AI_PRESETS, AiPresetId } from './ai-presets.ts';

// The AIs you've saved, which one is in use, and how the app talks to each.
// Every field has a default, so a settings file without an "ai" section
// still works. The kinds of AI you can add are in ai-presets.ts.

// A .bat or .cmd file as the program: the app opens it in its own window,
// as a double-click does, and never closes that window itself.
export const opensWindow = (exe: string): boolean => /\.(bat|cmd)$/i.test(exe.trim());

// How long the AI may think before it answers, when thinking is on. Low,
// medium and high each have a limit (THINKING_TOKENS). max sets none: the AI
// thinks as long as it likes, as Bonsai 2 does by default. An older settings
// file may say "xhigh", which is high.
export const ThinkingEffort = z.preprocess((v) => (v === 'xhigh' ? 'high' : v), z.enum(['low', 'medium', 'high', 'max']));
export type ThinkingEffort = z.infer<typeof ThinkingEffort>;

// The most each level may think, in tokens: the same steps as PrismML's own
// chat page for Bonsai 2. The answer gets its own room on top (maxTokens).
export const THINKING_TOKENS: Record<Exclude<ThinkingEffort, 'max'>, number> = { low: 512, medium: 2048, high: 8192 };

// One task's settings (parse, rate, …), each with its own defaults.
function taskSettings(defaults: { temperature: number; maxTokens: number; thinking: boolean; effort?: ThinkingEffort }) {
  return z
    .strictObject({
      // null means "use this AI's model".
      model: z.string().nullable().default(null),
      temperature: z.number().min(0).max(2).default(defaults.temperature),
      // The longest answer. Thinking comes on top, except with max.
      maxTokens: z.number().int().min(16).default(defaults.maxTokens),
      thinking: z.boolean().default(defaults.thinking),
      thinkingEffort: ThinkingEffort.default(defaults.effort ?? 'medium'),
      // Added to the request body last. A null value removes that field.
      extra: z.record(z.string(), z.unknown()).default({}),
    })
    .prefault({});
}

const ParseTaskSettings = taskSettings({ temperature: 0.2, maxTokens: 4096, thinking: false });
const RateTaskSettings = taskSettings({ temperature: 0.3, maxTokens: 2048, thinking: false });
// A quick rating from a card in a search list: a short answer, and no thinking.
const CardTaskSettings = taskSettings({ temperature: 0.2, maxTokens: 512, thinking: false });
// Resumes and cover letters: the model thinks first, for as long as it
// likes, and writes at length.
const WriteTaskSettings = taskSettings({ temperature: 0.6, maxTokens: 8192, thinking: true, effort: 'max' });
// Reading an email: short, and no thinking.
const EmailTaskSettings = taskSettings({ temperature: 0.1, maxTokens: 1024, thinking: false });
export type TaskSettings = z.infer<typeof ParseTaskSettings>;

const ManagedSettings = z.strictObject({
  enabled: z.boolean().default(true),
  // Relative paths are relative to the app folder.
  exe: z.string().min(1).default('ai/llama.cpp/llama-server.exe'),
  args: z
    .array(z.string())
    .default(() => [
      '-m',
      'ai/models/Ternary-Bonsai-2-27B-PQ2_0.gguf',
      '-ngl',
      '99',
      '-fa',
      'on',
      '-c',
      '32768',
      '--jinja',
      '--port',
      '8080',
    ]),
  startTimeoutSec: z.number().int().min(5).default(120),
});

// An AI's id: made from its name when you add it, and never changed after,
// because its API key is stored under it.
export const AiId = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'An AI id may only use a–z, 0–9 and single dashes between them.')
  .max(40, 'An AI id is 40 characters at most.');

// One saved AI: its name, and how the app talks to it.
export const SavedAi = z.strictObject({
  id: AiId,
  name: z.string().trim().min(1, 'An AI needs a name.').max(60, 'Keep the name to 60 characters or fewer.'),
  preset: AiPresetId.default('llama-server'),
  baseUrl: z.url().default('http://127.0.0.1:8080/v1'),
  // llama-server ignores the name. Ollama, LM Studio and most others need one.
  model: z.string().default(''),
  timeoutSec: z.number().int().min(5).default(300),
  // Stop a llama-server the app started after this many idle minutes, to
  // free the graphics card. Off unless you turn it on: then it runs until
  // the app stops.
  stopWhenIdle: z.boolean().default(false),
  idleMinutes: z.number().int().min(1).default(15),
  managed: ManagedSettings.prefault({}),
  tasks: z
    .strictObject({
      parse: ParseTaskSettings,
      rate: RateTaskSettings,
      card: CardTaskSettings,
      write: WriteTaskSettings,
      email: EmailTaskSettings,
    })
    .prefault({}),
});
export type SavedAi = z.infer<typeof SavedAi>;

export const DEFAULT_AI_ID = 'bonsai-2';

// The name an AI from an older, one-AI settings file gets.
const OLD_NAMES: Partial<Record<string, string>> = {
  'llama-server': 'Bonsai 2',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  custom: 'My AI server',
};

// An id made from a name: lower case, a–z, 0–9 and single dashes, at most
// 40 characters, and not one already taken ("Claude" again is "claude-2").
// Accents are dropped, so "Café" is "cafe".
export function newAiId(name: string, taken: readonly string[]): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = (max: number) => slug.slice(0, max).replace(/-+$/, '') || 'ai';
  const base = cut(40);
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${cut(40 - `-${n}`.length)}-${n}`;
    if (!taken.includes(id)) return id;
  }
}

// A new AI of one kind: an id made from its name, the preset's address
// (empty for another OpenAI-style server, for you to fill in) and its first
// suggested model. A preset that needs no model (llama-server) gets none:
// there the model names the file it expects, and you haven't picked one.
// Everything else starts at the defaults. It lives here, not in
// ai-presets.ts, so the two files don't import each other.
export function newSavedAi(preset: AiPresetId, name: string, taken: readonly string[]): SavedAi {
  const kind = AI_PRESETS[preset];
  const defaults = SavedAi.omit({ id: true, name: true }).parse({ preset });
  return {
    id: newAiId(name, taken),
    name,
    ...defaults,
    baseUrl: kind.baseUrl ?? '',
    model: kind.needsModel ? (kind.models[0]?.id ?? '') : '',
    managed: { ...defaults.managed, enabled: kind.managed },
  };
}

// Before Phase 8 the "ai" section held one AI's fields. Read like that (or
// left out), it becomes one saved AI. The file keeps its old shape until the
// next save. An object with "active" or "saved" is the new shape, so a typo
// there is refused, not read as one AI.
function fromOldShape(value: unknown): unknown {
  const ai = value === undefined ? {} : value;
  if (ai === null || typeof ai !== 'object' || Array.isArray(ai) || 'active' in ai || 'saved' in ai) return ai;
  const preset = (ai as { preset?: unknown }).preset;
  const name = OLD_NAMES[typeof preset === 'string' ? preset : 'llama-server'] ?? 'My AI';
  const one = { id: newAiId(name, []), name, ...ai };
  return { active: one.id, saved: [one] };
}

// The "ai" section in its own shape only. A change sent to the API uses
// this, so a change in the older shape is refused, never read as one AI
// that replaces all the others.
export const StrictAiSettings = z
  .strictObject({
    // The id of the AI the whole app uses now.
    active: AiId,
    saved: z.array(SavedAi).min(1, 'Keep at least one AI.'),
  })
  .superRefine((ai, ctx) => {
    const seen = new Set<string>();
    for (const one of ai.saved) {
      if (seen.has(one.id)) ctx.addIssue({ code: 'custom', path: ['saved'], message: `AI id '${one.id}' is used twice.` });
      seen.add(one.id);
    }
    if (!seen.has(ai.active)) {
      ctx.addIssue({ code: 'custom', path: ['active'], message: `The AI in use, '${ai.active}', isn't one of the saved AIs.` });
    }
  });

// The "ai" section as settings.json is read: the older shape too.
export const AiSettings = z.preprocess(fromOldShape, StrictAiSettings);
export type AiSettings = z.infer<typeof AiSettings>;

// The AI the whole app uses now.
export function activeAi(ai: AiSettings): SavedAi {
  const found = ai.saved.find((one) => one.id === ai.active);
  if (!found) throw new Error(`The AI in use, '${ai.active}', isn't one of the saved AIs.`);
  return found;
}

// A model file's name, in lower case and without its folder, if it is one.
// llama-server runs .gguf files, so anything else (say, a model name left
// over from another kind of AI) isn't a file the app can check.
function modelFile(path: string | undefined): string | null {
  const name = (path ?? '').trim().replaceAll('\\', '/').split('/').pop()!.toLowerCase();
  return name.endsWith('.gguf') ? name : null;
}

// The model file a llama-server AI should run, so the app can tell when
// another one answers on its address. For a program the app starts, it's
// the file after -m or --model. Otherwise (your .bat file, or a server you
// start yourself) it's the Model file you filled in, if any. Every other
// kind of AI names its own models, so it has none.
export function expectedModelFile(ai: SavedAi): string | null {
  if (ai.preset !== 'llama-server') return null;
  if (ai.managed.enabled && !opensWindow(ai.managed.exe)) {
    const { args } = ai.managed;
    const at = args.findIndex((arg) => arg === '-m' || arg === '--model');
    const file = at === -1 ? null : modelFile(args[at + 1]);
    if (file) return file;
  }
  return modelFile(ai.model);
}

const originOf = (ai: SavedAi): string | null => {
  try {
    return new URL(ai.baseUrl).origin;
  } catch {
    return null;
  }
};

// Said once, at a switch, when the AI you leave may still be answering on
// the new one's address and the app can't tell: the old one is a .bat file
// or a server you start yourself (the app never stops those), and the new
// one has no model file to check.
export function sameAddressWarning(from: SavedAi, to: SavedAi): string | null {
  if (from.id === to.id || from.preset !== 'llama-server' || to.preset !== 'llama-server') return null;
  const origin = originOf(from);
  if (origin === null || origin !== originOf(to)) return null;
  const appStopsIt = from.managed.enabled && !opensWindow(from.managed.exe);
  if (appStopsIt || expectedModelFile(to) !== null) return null;
  return `${from.name} may still be running on ${new URL(from.baseUrl).host}. Close its window if it is.`;
}

// Test connection, or the model list, for any AI: the one in the form,
// saved or not, with the key you typed. Nothing in it is saved.
export const AiCheckRequest = z.strictObject({
  ai: SavedAi,
  key: z.string().trim().min(1).max(1000).optional(),
});
export type AiCheckRequest = z.infer<typeof AiCheckRequest>;

export const AiModelsResult = z.object({
  ok: z.boolean(),
  models: z.array(z.string()),
  // Why there's no list, in a sentence.
  detail: z.string().nullable(),
});
export type AiModelsResult = z.infer<typeof AiModelsResult>;

export const AiState = z.enum(['off', 'starting', 'ready', 'busy', 'error']);
export type AiState = z.infer<typeof AiState>;

export const AiStatus = z.object({
  state: AiState,
  detail: z.string().nullable(),
  // The AI in use.
  id: z.string(),
  name: z.string(),
  preset: AiPresetId,
  baseUrl: z.string(),
});
export type AiStatus = z.infer<typeof AiStatus>;

export const AiTestResult = z.object({
  ok: z.boolean(),
  detail: z.string(),
  models: z.array(z.string()),
  replyMs: z.number().nullable(),
});
export type AiTestResult = z.infer<typeof AiTestResult>;
