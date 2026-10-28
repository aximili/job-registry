// The AiProvider port: how the app talks to any AI server. The adapter behind
// it can change (llama-server, Ollama, LM Studio, a fake in tests) without
// touching the rest of the app. See docs/architecture.md §6.1.

import type { ThinkingEffort } from '../../../shared/contracts/index.ts';

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
  extra?: Record<string, unknown>;
};

// The model's "thinking" is kept apart from its answer, so it never ends up
// in a parsed field or a document.
export type ChatResult = { text: string; thinking: string };
export type ChatChunk = { kind: 'text' | 'thinking'; text: string };

export type ProviderHealth = { ok: boolean; models: string[]; detail: string | null };

export interface AiProvider {
  chat(req: ChatRequest, opts?: { signal?: AbortSignal }): Promise<ChatResult>;
  chatStream(req: ChatRequest, opts?: { signal?: AbortSignal }): AsyncIterable<ChatChunk>;
  health(): Promise<ProviderHealth>;
}
