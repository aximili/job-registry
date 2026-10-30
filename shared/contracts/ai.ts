import { z } from 'zod';

// Which AI server the app talks to, and how. Every field has a default, so
// a settings file without an "ai" section still works.

export const AiPresetId = z.enum(['llama-server', 'ollama', 'lmstudio', 'custom']);
export type AiPresetId = z.infer<typeof AiPresetId>;

export type AiPreset = { label: string; baseUrl: string | null; managed: boolean; needsModel: boolean };

export const AI_PRESETS: Record<AiPresetId, AiPreset> = {
  'llama-server': {
    label: 'Bonsai 2 (llama-server)',
    baseUrl: 'http://127.0.0.1:8080/v1',
    managed: true,
    needsModel: false,
  },
  ollama: { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', managed: false, needsModel: true },
  lmstudio: { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', managed: false, needsModel: true },
  custom: { label: 'Another OpenAI-style server', baseUrl: null, managed: false, needsModel: true },
};

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
      // null means "use ai.model".
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

export const AiSettings = z.strictObject({
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
export type AiSettings = z.infer<typeof AiSettings>;

export const AiState = z.enum(['off', 'starting', 'ready', 'busy', 'error']);
export type AiState = z.infer<typeof AiState>;

export const AiStatus = z.object({
  state: AiState,
  detail: z.string().nullable(),
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
