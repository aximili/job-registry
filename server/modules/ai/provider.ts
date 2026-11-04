// The AiProvider port: how the app talks to any AI server. The adapter behind
// it can change (llama-server, Ollama, LM Studio, a fake in tests) without
// touching the rest of the app. See docs/architecture.md §6.1.

import type { AiDialect, AiPresetId, ThinkingEffort } from '../../../shared/contracts/index.ts';

// The AI an adapter talks to: from a saved AI, its key and its preset.
export type ProviderConfig = {
  // The AI's own name, for error messages ("Claude – mine refused its API key…").
  name: string;
  preset: AiPresetId;
  baseUrl: string;
  model: string;
  timeoutSec: number;
  // Sent only to this AI's own address. Never in an error or a log.
  apiKey: string | null;
  // How this provider wants to be asked (AI_PRESETS[preset].dialect).
  dialect: AiDialect;
};

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatRequest = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  // Constrained JSON output, from a zod schema.
  jsonSchema?: { name: string; schema: object };
  // false: answer straight away. true: think first, at thinkingEffort.
  thinking?: boolean;
  thinkingEffort?: ThinkingEffort;
  // Added to the request body last, from settings. A null removes a field.
  // The OpenAI-style connector adds top-level fields (a shallow merge). The
  // Claude connector deep-merges, so a nested field such as
  // output_config.effort changes only itself.
  extra?: Record<string, unknown>;
};

// The model's "thinking" is kept apart from its answer, so it never ends up
// in a parsed field or a document.
export type ChatResult = { text: string; thinking: string };
export type ChatChunk = { kind: 'text' | 'thinking'; text: string };

export type ProviderHealth = { ok: boolean; models: string[]; detail: string | null };

// The sentence for an AI that didn't answer at all: the adapters', and the AI
// service's when a health check gives no sentence of its own.
export const cantReachSentence = (ai: { name: string; baseUrl: string }): string =>
  `Can't reach ${ai.name} at ${ai.baseUrl}. Check that it's running, or pick another AI in Settings.`;

// How to get past a problem with one AI, such as a usage limit or a declined
// request. The adapters' sentences end with the first: the AI pill changes
// the AI in use. A writing AI that isn't the AI in use is changed where you
// write, so the AI service puts the second in its place.
export const USE_ANOTHER_AI = 'switch to another AI from the AI pill at the top';
export const USE_ANOTHER_WRITER = 'pick another writing AI beside the button, or in Settings → AI';

export interface AiProvider {
  chat(req: ChatRequest, opts?: { signal?: AbortSignal }): Promise<ChatResult>;
  chatStream(req: ChatRequest, opts?: { signal?: AbortSignal }): AsyncIterable<ChatChunk>;
  health(): Promise<ProviderHealth>;
}
