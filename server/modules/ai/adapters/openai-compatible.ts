// The one adapter for every OpenAI-style server: PrismML's llama-server,
// Ollama, LM Studio, vLLM and others. It speaks /v1/chat/completions and
// /v1/models over fetch, and turns every failure into a plain sentence.

import { AiRefusedError, AiUnavailableError } from '../../../core/errors.ts';
import type { AiProvider, ChatChunk, ChatRequest, ChatResult, ProviderHealth } from '../provider.ts';

export type OpenAiConfig = { baseUrl: string; model: string; timeoutSec: number };

const HEALTH_TIMEOUT_MS = 5000;

export function createOpenAiCompatibleProvider(
  getConfig: () => OpenAiConfig,
  opts: { fetch?: typeof fetch } = {},
): AiProvider {
  const doFetch = opts.fetch ?? fetch;

  function body(req: ChatRequest, config: OpenAiConfig, stream: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {
      model: req.model || config.model || 'default',
      messages: req.messages,
      stream,
    };
    if (req.temperature !== undefined) out.temperature = req.temperature;
    if (req.maxTokens !== undefined) out.max_tokens = req.maxTokens;
    if (req.jsonSchema) {
      out.response_format = { type: 'json_schema', json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } };
    }
    // The field llama-server (Bonsai 2) and Ollama both use. "none" turns
    // thinking off; Bonsai 2 refuses "high", so "medium" is the default.
    if (req.thinking === false) out.reasoning_effort = 'none';
    if (req.thinking === true) out.reasoning_effort = req.thinkingEffort ?? 'medium';
    for (const [key, value] of Object.entries(req.extra ?? {})) {
      if (value === null) delete out[key];
      else out[key] = value;
    }
    return out;
  }

  async function post(req: ChatRequest, stream: boolean, signal?: AbortSignal): Promise<Response> {
    const config = getConfig();
    const timeout = AbortSignal.timeout(config.timeoutSec * 1000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await doFetch(`${trimSlash(config.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body(req, config, stream)),
        signal: combined,
      });
    } catch (err) {
      throw describe(err, config);
    }
    if (!res.ok) throw new AiRefusedError(`The AI at ${config.baseUrl} answered with an error (${res.status}): ${await errorText(res)}`);
    return res;
  }

  return {
    async chat(req, o = {}): Promise<ChatResult> {
      const config = getConfig();
      const res = await post(req, false, o.signal);
      let data: { choices?: { message?: Record<string, unknown> }[] };
      try {
        data = (await res.json()) as typeof data;
      } catch (err) {
        throw describe(err, config);
      }
      const message = data.choices?.[0]?.message ?? {};
      const raw = typeof message.content === 'string' ? message.content : '';
      const split = splitThinking(raw);
      const reasoning =
        typeof message.reasoning_content === 'string'
          ? message.reasoning_content
          : typeof message.reasoning === 'string'
            ? message.reasoning
            : '';
      return { text: split.text.trim(), thinking: [reasoning, split.thinking].filter(Boolean).join('\n') };
    },

    async *chatStream(req, o = {}): AsyncIterable<ChatChunk> {
      const config = getConfig();
      const res = await post(req, true, o.signal);
      const splitter = thinkSplitter();
      let cutOff = false;
      try {
        for await (const delta of sseDeltas(res)) {
          if (delta.finish_reason === 'length') cutOff = true;
          const reasoning = delta.reasoning_content ?? delta.reasoning;
          if (typeof reasoning === 'string' && reasoning) yield { kind: 'thinking', text: reasoning };
          if (typeof delta.content === 'string' && delta.content) yield* splitter.push(delta.content);
        }
        yield* splitter.end();
        // max_tokens ran out (thinking counts towards it): what came is kept, but it isn't finished.
        if (cutOff) throw new AiRefusedError(CUT_OFF);
      } catch (err) {
        throw describe(err, config);
      }
    },

    async health(): Promise<ProviderHealth> {
      const config = getConfig();
      try {
        const res = await doFetch(`${trimSlash(config.baseUrl)}/models`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
        if (!res.ok) {
          return { ok: false, models: [], detail: `The AI at ${config.baseUrl} answered with an error (${res.status}): ${await errorText(res)}` };
        }
        const data = (await res.json()) as { data?: { id?: unknown }[] };
        const models = (data.data ?? []).flatMap((m) => (typeof m.id === 'string' ? [m.id] : []));
        return { ok: true, models, detail: null };
      } catch (err) {
        return { ok: false, models: [], detail: describe(err, { ...config, timeoutSec: HEALTH_TIMEOUT_MS / 1000 }).message };
      }
    },
  };
}

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

// A cancel stays a cancel. Everything else becomes a sentence that says what
// went wrong and where.
function describe(err: unknown, config: OpenAiConfig): Error {
  if (err instanceof AiUnavailableError) return err;
  const name = (err as Error)?.name;
  if (name === 'AbortError') return err as Error;
  if (name === 'TimeoutError') {
    return new AiRefusedError(`The AI at ${config.baseUrl} didn't answer within ${config.timeoutSec} seconds.`);
  }
  return new AiUnavailableError(
    `Can't reach the AI at ${config.baseUrl}. Check that it's running, or pick another AI in Settings.`,
  );
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  let message = text;
  try {
    const data = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof data.error === 'string') message = data.error;
    else if (data.error && typeof (data.error as { message?: unknown }).message === 'string') {
      message = (data.error as { message: string }).message;
    } else if (typeof data.message === 'string') message = data.message;
  } catch {
    // Not JSON: show the text as it is.
  }
  return (message.trim() || res.statusText || 'no details').slice(0, 300);
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

type Delta = { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; finish_reason?: unknown };

const CUT_OFF =
  'The AI ran out of room before it finished. Raise maxTokens in config\\settings.json (ai.tasks.write for resumes and cover letters), then try again.';

async function* sseDeltas(res: Response): AsyncIterable<Delta> {
  if (!res.body) return;
  const decoder = new TextDecoder();
  let pending = '';
  for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data) as { choices?: { delta?: Delta; finish_reason?: unknown }[] };
        const choice = parsed.choices?.[0];
        if (choice?.delta || choice?.finish_reason) yield { ...choice.delta, finish_reason: choice.finish_reason };
      } catch {
        // A line that isn't JSON (a comment or keep-alive) is skipped.
      }
    }
  }
}
