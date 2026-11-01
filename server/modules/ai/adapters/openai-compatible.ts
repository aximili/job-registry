// The one adapter for every OpenAI-style server: PrismML's llama-server,
// Ollama, LM Studio, vLLM, and the cloud providers that speak the same way
// (OpenAI, Gemini, DeepSeek and others). It speaks /chat/completions and
// /models over fetch, in each provider's dialect, sends the AI's key, and
// turns every failure into a plain sentence that names the AI.

import { AiRefusedError } from '../../../core/errors.ts';
import { THINKING_TOKENS, type ThinkingLevel } from '../../../../shared/contracts/index.ts';
import type { AiProvider, ChatChunk, ChatMessage, ChatRequest, ChatResult, ProviderConfig, ProviderHealth } from '../provider.ts';
import { cutOffSentence, httpError, needsKeyError, requestError, streamError } from './http-errors.ts';
import { HEALTH_TIMEOUT_MS, sseData, timeLimit, trimSlash } from './http.ts';

export function createOpenAiCompatibleProvider(
  getConfig: () => ProviderConfig,
  opts: { fetch?: typeof fetch } = {},
): AiProvider {
  const doFetch = opts.fetch ?? fetch;

  function body(req: ChatRequest, config: ProviderConfig, stream: boolean): Record<string, unknown> {
    const { dialect } = config;
    // A provider that takes only json_object gets the schema as text.
    const schemaAsText = dialect.json === 'object' ? req.jsonSchema : undefined;
    const out: Record<string, unknown> = {
      model: req.model || config.model || 'default',
      messages: schemaAsText ? withSchemaText(req.messages, schemaAsText.schema) : req.messages,
      stream,
    };
    // Some providers refuse a temperature. Z.ai takes 0 to 1.
    if (req.temperature !== undefined && dialect.temperature) {
      out.temperature = config.preset === 'zai' ? Math.min(req.temperature, 1) : req.temperature;
    }
    const tokens = dialect.maxTokens;
    if (req.maxTokens !== undefined) out[tokens] = req.maxTokens;
    if (req.jsonSchema) {
      out.response_format = schemaAsText
        ? { type: 'json_object' }
        : { type: 'json_schema', json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } };
    }
    if (dialect.thinking === 'llama') {
      // reasoning_effort is the field llama-server (Bonsai 2) and Ollama both
      // use, and "none" turns thinking off.
      if (req.thinking === false) out.reasoning_effort = 'none';
      if (req.thinking === true) {
        const effort = req.thinkingEffort ?? 'medium';
        if (effort === 'max') {
          // No limits at all: the AI thinks and writes as long as it likes
          // (Bonsai 2's own default is "xhigh").
          delete out[tokens];
        } else {
          // Bonsai 2 refuses "high": its strongest is "xhigh". Thinking counts
          // towards max_tokens, so its limit comes on top of the answer's.
          // llama-server stops the thinking there and has the AI answer.
          out.reasoning_effort = effort === 'high' ? 'xhigh' : effort;
          out.thinking_budget_tokens = THINKING_TOKENS[effort];
          if (req.maxTokens !== undefined) out[tokens] = req.maxTokens + THINKING_TOKENS[effort];
        }
      }
    } else {
      // The provider's own fields for this level, from the catalogue. A copy,
      // so nothing can change the catalogue itself.
      const level: ThinkingLevel = req.thinking === true ? (req.thinkingEffort ?? 'medium') : 'off';
      Object.assign(out, structuredClone(dialect.thinking[level]));
      // Thinking counts towards the limit, so its room comes on top of the
      // answer's. No limit sends none at all. Off still thinks a little on
      // many cloud models (they can't stop), so it gets Medium's room, as
      // Claude's connector does. The limit is only a ceiling: room the AI
      // doesn't use isn't billed.
      if (level === 'max') delete out[tokens];
      else if (req.maxTokens !== undefined) out[tokens] = req.maxTokens + THINKING_TOKENS[level === 'off' ? 'medium' : level];
    }
    for (const [key, value] of Object.entries(req.extra ?? {})) {
      if (value === null) delete out[key];
      else out[key] = value;
    }
    return out;
  }

  async function post(req: ChatRequest, stream: boolean, config: ProviderConfig, signals: AbortSignal[]): Promise<Response> {
    const noKey = needsKeyError(config);
    if (noKey) throw noKey;
    let res: Response;
    try {
      res = await doFetch(`${trimSlash(config.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(config) },
        body: JSON.stringify(body(req, config, stream)),
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      throw requestError(err, config, stream);
    }
    if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''), config);
    return res;
  }

  return {
    async chat(req, o = {}): Promise<ChatResult> {
      const config = getConfig();
      // The whole answer must come within the time limit.
      const limit = timeLimit(config.timeoutSec);
      try {
        const res = await post(req, false, config, [limit.signal, ...(o.signal ? [o.signal] : [])]);
        let data: { choices?: { message?: Record<string, unknown>; finish_reason?: unknown }[]; error?: unknown } | null;
        try {
          data = (await res.json()) as typeof data;
        } catch (err) {
          throw requestError(err, config, false);
        }
        const choice = data?.choices?.[0];
        // An error after HTTP 200 (OpenRouter): say what it was, not "the answer didn't fit".
        const error = data?.error ?? undefined;
        if (choice?.finish_reason === 'error' || error !== undefined) throw streamError(error, config);
        // max_tokens ran out, often while the AI was still thinking: the answer is missing or cut short.
        if (choice?.finish_reason === 'length') throw new AiRefusedError(cutOffSentence(config));
        const message = choice?.message ?? {};
        const parts = contentParts(message.content);
        const split = splitThinking(parts.text);
        const reasoning =
          typeof message.reasoning_content === 'string'
            ? message.reasoning_content
            : typeof message.reasoning === 'string'
              ? message.reasoning
              : '';
        return { text: split.text.trim(), thinking: [reasoning, parts.thinking, split.thinking].filter(Boolean).join('\n') };
      } finally {
        limit.stop();
      }
    },

    async *chatStream(req, o = {}): AsyncIterable<ChatChunk> {
      const config = getConfig();
      // A stream may take as long as it needs, as long as it keeps sending:
      // the time limit starts again with each piece, thinking included.
      const limit = timeLimit(config.timeoutSec);
      try {
        const res = await post(req, true, config, [limit.signal, ...(o.signal ? [o.signal] : [])]);
        const splitter = thinkSplitter();
        let cutOff = false;
        try {
          // Every line restarts the time limit, comments too: OpenRouter sends
          // ": OPENROUTER PROCESSING" while the AI thinks.
          for await (const delta of sseDeltas(res, limit.restart)) {
            if (delta.finish_reason === 'length') cutOff = true;
            const reasoning = delta.reasoning_content ?? delta.reasoning;
            if (typeof reasoning === 'string' && reasoning) yield { kind: 'thinking', text: reasoning };
            const parts = contentParts(delta.content);
            if (parts.thinking) yield { kind: 'thinking', text: parts.thinking };
            if (parts.text) yield* splitter.push(parts.text);
            // An error after HTTP 200 (OpenRouter): what came is kept, then it stops.
            if (delta.finish_reason === 'error' || delta.error !== undefined) {
              yield* splitter.end();
              throw streamError(delta.error, config);
            }
          }
          yield* splitter.end();
          // max_tokens or the context ran out (thinking counts): what came is kept, but it isn't finished.
          if (cutOff) throw new AiRefusedError(cutOffSentence(config));
        } catch (err) {
          throw requestError(err, config, true);
        }
      } finally {
        limit.stop();
      }
    },

    async health(): Promise<ProviderHealth> {
      const config = getConfig();
      const noKey = needsKeyError(config);
      if (noKey) return { ok: false, models: [], detail: noKey.message };
      // Some providers have no model list to ask (Z.ai, Qwen).
      if (!config.dialect.listModels) return { ok: true, models: [], detail: null };
      try {
        const res = await doFetch(`${trimSlash(config.baseUrl)}/models`, {
          headers: authHeader(config),
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        if (!res.ok) {
          return { ok: false, models: [], detail: httpError(res.status, await res.text().catch(() => ''), config).message };
        }
        const data = (await res.json()) as { data?: { id?: unknown }[] };
        const models = (data.data ?? []).flatMap((m) => (typeof m.id === 'string' ? [m.id] : []));
        return { ok: true, models, detail: null };
      } catch (err) {
        return { ok: false, models: [], detail: requestError(err, { ...config, timeoutSec: HEALTH_TIMEOUT_MS / 1000 }, false).message };
      }
    },
  };
}

// The key goes only to this AI's own address.
const authHeader = (config: ProviderConfig): Record<string, string> =>
  config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {};

// For a provider that takes only json_object: the schema goes at the end of
// the system message, as text. DeepSeek wants the word "json" in the prompt,
// and Qwen "JSON", so it has both. The messages are copied, not changed, so
// a second try doesn't add it twice.
function withSchemaText(messages: ChatMessage[], schema: object): ChatMessage[] {
  const text = `Reply in json: one object that matches this JSON Schema:\n${JSON.stringify(schema)}`;
  const at = messages.findIndex((m) => m.role === 'system');
  if (at === -1) return [{ role: 'system', content: text }, ...messages];
  return messages.map((m, i) => (i === at ? { ...m, content: `${m.content}\n\n${text}` } : m));
}

// An answer's content is usually text. Mistral sends a list of parts when it
// thinks: { type: 'text', text } for the answer, and { type: 'thinking',
// thinking: [{ type: 'text', text }] } for the thinking.
function contentParts(content: unknown): { text: string; thinking: string } {
  if (typeof content === 'string') return { text: content, thinking: '' };
  if (!Array.isArray(content)) return { text: '', thinking: '' };
  let text = '';
  let thinking = '';
  for (const part of content as { type?: unknown; text?: unknown; thinking?: unknown }[]) {
    if (part?.type === 'text' && typeof part.text === 'string') text += part.text;
    if (part?.type === 'thinking') thinking += partText(part.thinking);
  }
  return { text, thinking };
}

function partText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((p: { type?: unknown; text?: unknown } | null) => (p?.type === 'text' && typeof p.text === 'string' ? p.text : ''))
    .join('');
}

function splitThinking(text: string): { text: string; thinking: string } {
  const thoughts: string[] = [];
  const rest = text.replace(/<think>([\s\S]*?)(?:<\/think>|$)/g, (_m, inner: string) => {
    thoughts.push(inner.trim());
    return '';
  });
  return { text: rest, thinking: thoughts.join('\n') };
}

// Some servers send thinking inside the answer, as <think>…</think>. In a
// stream, a tag can be split across two chunks, so the last few characters
// are held back until it's clear they aren't the start of a tag.
function thinkSplitter() {
  let buffer = '';
  let thinking = false;

  function* drain(final: boolean): Generator<ChatChunk> {
    for (;;) {
      const tag = thinking ? '</think>' : '<think>';
      const at = buffer.indexOf(tag);
      if (at !== -1) {
        const before = buffer.slice(0, at);
        if (before) yield { kind: thinking ? 'thinking' : 'text', text: before };
        buffer = buffer.slice(at + tag.length);
        thinking = !thinking;
        continue;
      }
      const keep = final ? 0 : partialTagLength(buffer, tag);
      const out = buffer.slice(0, buffer.length - keep);
      if (out) yield { kind: thinking ? 'thinking' : 'text', text: out };
      buffer = buffer.slice(buffer.length - keep);
      return;
    }
  }

  return {
    push(text: string) {
      buffer += text;
      return drain(false);
    },
    end() {
      return drain(true);
    },
  };
}

// How many characters at the end of text could be the start of tag.
function partialTagLength(text: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (tag.startsWith(text.slice(-n))) return n;
  }
  return 0;
}

type Delta = { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; finish_reason?: unknown; error?: unknown };

// The stream's pieces. alive() is called for every line that comes, so a
// server that is still working keeps the time limit from running out.
async function* sseDeltas(res: Response, alive: () => void): AsyncIterable<Delta> {
  for await (const data of sseData(res, alive)) {
    if (data === '[DONE]') return;
    let parsed: { choices?: { delta?: Delta; finish_reason?: unknown }[]; error?: unknown };
    try {
      parsed = JSON.parse(data) as typeof parsed;
    } catch {
      // A line that isn't JSON is skipped.
      continue;
    }
    // So is JSON that isn't an object ("data: null").
    if (!parsed || typeof parsed !== 'object') continue;
    const choice = parsed.choices?.[0];
    // An error can come with HTTP 200, inside the stream (OpenRouter).
    const error = parsed.error ?? undefined;
    if (choice?.delta || choice?.finish_reason || error !== undefined) {
      yield { ...choice?.delta, finish_reason: choice?.finish_reason, error };
    }
  }
}
