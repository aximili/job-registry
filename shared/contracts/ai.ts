import { z } from 'zod';

// Which AI server the app talks to, and how. Every field has a default, so
// a settings file without an "ai" section still works.

export const AiPresetId = z.enum(['llama-server', 'ollama', 'lmstudio', 'custom']);
export type AiPresetId = z.infer<typeof AiPresetId>;

export type AiPreset = { label: string; baseUrl: string | null; managed: boolean; needsModel: boolean };

export const AI_PRESETS: Record<AiPresetId, AiPreset> = {
  'llama-server': {
    label: 'Bonsai 2 (llama-server, started by the app)',
    baseUrl: 'http://127.0.0.1:8080/v1',
    managed: true,
    needsModel: false,
  },
  ollama: { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', managed: false, needsModel: true },
  lmstudio: { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', managed: false, needsModel: true },
  custom: { label: 'Another OpenAI-style server', baseUrl: null, managed: false, needsModel: true },
};

export const ThinkingEffort = z.enum(['low', 'medium', 'xhigh']);
export type ThinkingEffort = z.infer<typeof ThinkingEffort>;

// One task's settings (parse, rate, …), each with its own defaults.
function taskSettings(defaults: { temperature: number; maxTokens: number; thinking: boolean }) {
  return z
    .strictObject({
      // null means "use ai.model".
      model: z.string().nullable().default(null),
      temperature: z.number().min(0).max(2).default(defaults.temperature),
      maxTokens: z.number().int().min(16).default(defaults.maxTokens),
      thinking: z.boolean().default(defaults.thinking),
      thinkingEffort: ThinkingEffort.default('medium'),
      // Added to the request body last. A null value removes that field.
      extra: z.record(z.string(), z.unknown()).default({}),
    })
    .prefault({});
}

const ParseTaskSettings = taskSettings({ temperature: 0.2, maxTokens: 4096, thinking: false });
const RateTaskSettings = taskSettings({ temperature: 0.3, maxTokens: 2048, thinking: false });
// Resumes and cover letters: the model thinks first, and writes at length.
const WriteTaskSettings = taskSettings({ temperature: 0.6, maxTokens: 8192, thinking: true });
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
  idleMinutes: z.number().int().min(1).default(15),
  managed: ManagedSettings.prefault({}),
  tasks: z
    .strictObject({
      parse: ParseTaskSettings,
      rate: RateTaskSettings,
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
