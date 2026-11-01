// Claude's own connector: Anthropic's Messages API, with your API key. It
// speaks /messages and /models over fetch, asks for JSON with Claude's
// structured outputs, turns each thinking level into adaptive thinking with
// an effort, and marks the system message for prompt caching. Every failure
// becomes a plain sentence that names the AI. See docs/architecture.md §6.1.

import { AiRefusedError, type AiAccountError } from '../../../core/errors.ts';
import { THINKING_TOKENS, type ThinkingLevel } from '../../../../shared/contracts/index.ts';
import type { AiProvider, ChatChunk, ChatRequest, ChatResult, ProviderConfig, ProviderHealth } from '../provider.ts';
import { cutOffSentence, httpError, needsKeyError, requestError, streamError } from './http-errors.ts';
import { HEALTH_TIMEOUT_MS, sseData, timeLimit, trimSlash } from './http.ts';

const API_VERSION = '2023-06-01';

// Claude needs a max_tokens. The tasks always give their longest answer.
const DEFAULT_ANSWER_TOKENS = 4096;

// No limit's max_tokens when the model list doesn't give the model's own.
const NO_LIMIT_TOKENS = 64000;

// Schema words Claude's structured outputs refuse with a 400. zod still
// checks every answer against the full schema.
const REFUSED_SCHEMA_WORDS = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
]);

// The HTTP status Anthropic gives each error type, so an error inside a
// stream gets the same plain sentence (busy, a usage limit, a refused key).
const ERROR_STATUS = new Map([
  ['authentication_error', 401],
  ['permission_error', 403],
  ['billing_error', 402],
  ['rate_limit_error', 429],
  ['overloaded_error', 529],
]);

export function createAnthropicProvider(
  getConfig: () => ProviderConfig,
  opts: { fetch?: typeof fetch } = {},
): AiProvider {
  const doFetch = opts.fetch ?? fetch;
  // Each model's own max_tokens, by address, from the model list.
  const maxTokensByUrl = new Map<string, Map<string, number>>();

  // GET /models: the model ids. Each model's max_tokens is remembered too.
  async function listModels(config: ProviderConfig, signal: AbortSignal): Promise<string[]> {
    const res = await doFetch(`${trimSlash(config.baseUrl)}/models?limit=1000`, { headers: headers(config), signal });
    if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''), config);
    const data = (await res.json()) as { data?: { id?: unknown; max_tokens?: unknown }[] };
    const models = (data.data ?? []).filter((m): m is { id: string; max_tokens?: unknown } => typeof m?.id === 'string');
    const limits = models.flatMap((m): [string, number][] => (typeof m.max_tokens === 'number' ? [[m.id, m.max_tokens]] : []));
    maxTokensByUrl.set(trimSlash(config.baseUrl), new Map(limits));
    return models.map((m) => m.id);
  }

  // No limit: the most this model can write. The model list is asked once,
  // then remembered. If it can't be read, it's 64,000 this time, and the
  // list is asked again next time.
  async function noLimitTokens(config: ProviderConfig, model: string, signals: AbortSignal[]): Promise<number> {
    const url = trimSlash(config.baseUrl);
    if (!maxTokensByUrl.has(url)) {
      try {
        await listModels(config, AbortSignal.any([...signals, AbortSignal.timeout(HEALTH_TIMEOUT_MS)]));
      } catch (err) {
        // A cancel, or the request's own time limit, still stops the request.
        if (signals.some((s) => s.aborted)) throw err;
      }
    }
    return maxTokensByUrl.get(url)?.get(model) ?? NO_LIMIT_TOKENS;
  }

  // schema: the task's JSON schema as Claude takes it (claudeSchema), or null.
  async function body(
    req: ChatRequest,
    schema: unknown,
    config: ProviderConfig,
    stream: boolean,
    signals: AbortSignal[],
  ): Promise<Record<string, unknown>> {
    const model = req.model || config.model;
    const level: ThinkingLevel = req.thinking === true ? (req.thinkingEffort ?? 'medium') : 'off';
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    // Only fields the Messages API takes: anything else gets a 400. So no
    // temperature, which current models refuse.
    const out: Record<string, unknown> = {
      model,
      // Thinking counts towards max_tokens, so its room comes on top of the
      // answer's. max_tokens is only a ceiling, and adaptive thinking at
      // effort low may think past 512 tokens, so Off (which still thinks:
      // most models can't stop) and Low get Medium's room. No limit gets the
      // most the model can write.
      max_tokens:
        level === 'max'
          ? await noLimitTokens(config, model, signals)
          : (req.maxTokens ?? DEFAULT_ANSWER_TOKENS) + THINKING_TOKENS[level === 'off' || level === 'low' ? 'medium' : level],
      messages: req.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
    };
    // The system message is the fixed start of each prompt (the profile
    // comes first), so Claude can cache it from one request to the next.
    if (system) out.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
    if (stream) out.stream = true;
    if (schema) out.output_config = { format: { type: 'json_schema', schema } };
    // Adaptive thinking and an effort, from the catalogue. Merged, so
    // output_config keeps both the JSON format and the effort.
    const thinking = config.dialect.thinking === 'llama' ? null : config.dialect.thinking[level];
    if (thinking) merge(out, thinking);
    merge(out, req.extra ?? {});
    return out;
  }

  async function post(req: ChatRequest, stream: boolean, config: ProviderConfig, signals: AbortSignal[]): Promise<Response> {
    const noKey = needsKeyError(config);
    if (noKey) throw noKey;
    // Before anything is sent, and outside the try below: a schema Claude
    // can't take is a fault in the app, not "can't reach Claude".
    const schema = req.jsonSchema ? claudeSchema(req.jsonSchema.schema) : null;
    let res: Response;
    try {
      const payload = await body(req, schema, config, stream, signals);
      res = await doFetch(`${trimSlash(config.baseUrl)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers(config) },
        body: JSON.stringify(payload),
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
        let data: { content?: unknown; stop_reason?: unknown } | null;
        try {
          data = (await res.json()) as typeof data;
        } catch (err) {
          throw requestError(err, config, false);
        }
        const stopped = stopError(data?.stop_reason, config);
        if (stopped) throw stopped;
        // Thinking comes in its own blocks, so it never ends up in the text.
        const blocks = (Array.isArray(data?.content) ? data.content : []) as { type?: unknown; text?: unknown; thinking?: unknown }[];
        const text = blocks.map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('');
        const thinking = blocks.flatMap((b) => (b?.type === 'thinking' && typeof b.thinking === 'string' && b.thinking ? [b.thinking] : []));
        return { text: text.trim(), thinking: thinking.join('\n') };
      } finally {
        limit.stop();
      }
    },

    async *chatStream(req, o = {}): AsyncIterable<ChatChunk> {
      const config = getConfig();
      // A stream may take as long as it needs, as long as it keeps sending:
      // the time limit starts again with each line, pings included.
      const limit = timeLimit(config.timeoutSec);
      try {
        const res = await post(req, true, config, [limit.signal, ...(o.signal ? [o.signal] : [])]);
        let stopReason: unknown = null;
        let ended = false;
        try {
          for await (const event of streamEvents(res, limit.restart)) {
            if (event.type === 'content_block_delta') {
              // signature_delta carries nothing to show.
              const { delta } = event;
              if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) yield { kind: 'text', text: delta.text };
              if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) {
                yield { kind: 'thinking', text: delta.thinking };
              }
            } else if (event.type === 'message_delta') {
              stopReason = event.delta?.stop_reason ?? stopReason;
            } else if (event.type === 'message_stop') {
              // The end. There's no [DONE].
              ended = true;
              break;
            } else if (event.type === 'error') {
              // What came is kept, then it stops.
              throw eventError(event.error, config);
            }
          }
          // Out of room, or declined: what came is kept, but it isn't finished.
          const stopped = stopError(stopReason, config);
          if (stopped) throw stopped;
          // The stream closed with no message_stop and no stop reason: the
          // answer was cut short, so it mustn't look finished.
          if (!ended && stopReason === null) throw new AiRefusedError(`${config.name} stopped sending before it finished. Try again.`);
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
      try {
        return { ok: true, models: await listModels(config, AbortSignal.timeout(HEALTH_TIMEOUT_MS)), detail: null };
      } catch (err) {
        return { ok: false, models: [], detail: requestError(err, { ...config, timeoutSec: HEALTH_TIMEOUT_MS / 1000 }, false).message };
      }
    },
  };
}

// The key goes only to Claude's own address, in its own header. It isn't a
// Bearer token.
const headers = (config: ProviderConfig): Record<string, string> => ({
  ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
  'anthropic-version': API_VERSION,
});

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// Adds source's fields to target, as copies. A field that is an object on
// both sides is merged the same way, so a task's extra output_config.effort
// keeps the JSON format. A null removes a field.
function merge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (value === null) delete target[key];
    else if (isObject(value)) target[key] = merge(isObject(current) ? current : {}, value);
    else target[key] = structuredClone(value);
  }
  return target;
}

// The schema as Claude's structured outputs take it: every object closed
// (additionalProperties false), and none of the limits Claude refuses. A
// copy, so the task's own schema is left alone. An object open to other
// fields (a record) can't be closed without changing what it means, so it's
// refused. No task schema has one.
function claudeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(claudeSchema);
  if (!isObject(node)) return node;
  if ('additionalProperties' in node && node.additionalProperties !== false) {
    throw new Error("The Claude connector can't send a schema with open-ended objects.");
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (REFUSED_SCHEMA_WORDS.has(key)) continue;
    if ((key === 'properties' || key === '$defs' || key === 'definitions') && isObject(value)) {
      // Schemas by name: a property may be called "pattern", and keeps it.
      out[key] = Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, claudeSchema(schema)]));
    } else if (key === 'enum' || key === 'const' || key === 'default' || key === 'examples') {
      // Values, not schemas.
      out[key] = value;
    } else {
      out[key] = claudeSchema(value);
    }
  }
  const types = Array.isArray(node.type) ? (node.type as unknown[]) : [node.type];
  if (types.includes('object') || isObject(node.properties)) out.additionalProperties = false;
  return out;
}

// The sentence for an answer that stopped before it finished, or null.
function stopError(reason: unknown, config: ProviderConfig): AiRefusedError | null {
  // max_tokens ran out (thinking counts).
  if (reason === 'max_tokens') return new AiRefusedError(cutOffSentence(config));
  // The model's context is full: a longer answer wouldn't help.
  if (reason === 'model_context_window_exceeded') {
    return new AiRefusedError(
      `${config.name} couldn't fit the profile, the ad and the answer in its memory. Shorten your profile or the guide, then try again.`,
    );
  }
  // Claude's safety checks stopped it. The same request would stop again.
  if (reason === 'refusal') {
    return new AiRefusedError(`${config.name} declined to answer this request. You can switch to another AI from the AI pill at the top.`);
  }
  return null;
}

// The sentence for an error event inside a stream.
function eventError(error: unknown, config: ProviderConfig): AiAccountError | AiRefusedError {
  const type = isObject(error) ? error.type : undefined;
  const status = typeof type === 'string' ? ERROR_STATUS.get(type) : undefined;
  return status ? httpError(status, JSON.stringify({ error }), config) : streamError(error, config);
}

type StreamEvent = {
  type?: unknown;
  delta?: { type?: unknown; text?: unknown; thinking?: unknown; stop_reason?: unknown };
  error?: unknown;
};

// The stream's events. Each one says its own type, so the "event:" lines
// aren't needed. A line that isn't a JSON object is skipped.
async function* streamEvents(res: Response, alive: () => void): AsyncIterable<StreamEvent> {
  for await (const data of sseData(res, alive)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    if (isObject(parsed)) yield parsed as StreamEvent;
  }
}
