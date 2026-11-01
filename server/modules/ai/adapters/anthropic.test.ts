import { describe, expect, it } from 'vitest';
import { AI_PRESETS, CardRating, EmailClassification, ParsedJob, Rating, THINKING_TOKENS } from '../../../../shared/contracts/index.ts';
import { fakeFetch, slowStream, type FetchCall } from '../../../../tests/fakes/fake-fetch.ts';
import { AiAccountError, AiRefusedError, AiUnavailableError } from '../../../core/errors.ts';
import { toAiSchema } from '../json.ts';
import type { ChatRequest, ProviderConfig } from '../provider.ts';
import { createAnthropicProvider } from './anthropic.ts';

const KEY = 'sk-ant-api03-secret';

// Claude through Anthropic's own API, with a key.
const claude = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  name: 'Claude – mine',
  preset: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  model: 'claude-sonnet-5-5',
  timeoutSec: 10,
  apiKey: KEY,
  dialect: AI_PRESETS.anthropic.dialect,
  ...over,
});

const ask = (extra: Partial<ChatRequest> = {}): ChatRequest => ({
  messages: [
    { role: 'system', content: 'You read job ads.' },
    { role: 'user', content: 'The ad.' },
  ],
  ...extra,
});

const KEY_REFUSED = 'Claude – mine refused its API key. Check the key in Settings → AI.';
const LIMIT = "Claude – mine says you've reached a usage limit. Wait a while, or switch to another AI from the AI pill at the top.";
const BUSY = 'Claude – mine is busy right now. Try again in a minute.';
const NEEDS_KEY = 'Claude – mine needs an API key. Add it in Settings → AI.';
const CUT_OFF = 'Claude – mine ran out of room before it finished. In Settings → AI, give this task less thinking or a longer answer, then try again.';
const DECLINED = 'Claude – mine declined to answer this request. You can switch to another AI from the AI pill at the top.';
const CONTEXT_FULL = "Claude – mine couldn't fit the profile, the ad and the answer in its memory. Shorten your profile or the guide, then try again.";
const STOPPED_SENDING = 'Claude – mine stopped sending before it finished. Try again.';

// A whole answer, as POST /messages gives it.
const message = (content: Record<string, unknown>[], stopReason = 'end_turn') =>
  Response.json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });

// One server-sent event, as POST /messages streams it.
const event = (data: Record<string, unknown>) => `event: ${String(data.type)}\ndata: ${JSON.stringify(data)}`;
const messageStart = event({
  type: 'message_start',
  message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } },
});
const ping = event({ type: 'ping' });
const blockStart = (index: number, type: 'text' | 'thinking') =>
  event({ type: 'content_block_start', index, content_block: type === 'text' ? { type, text: '' } : { type, thinking: '', signature: '' } });
const blockStop = (index: number) => event({ type: 'content_block_stop', index });
const thinkingDelta = (thinking: string) => event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } });
const signatureDelta = event({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'EqQBCgIYAhIM' } });
const textDelta = (text: string) => event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } });
const stopWith = (stopReason: string) => [
  event({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 12 } }),
  event({ type: 'message_stop' }),
];
// No [DONE] line: Claude's stream ends with message_stop.
const stream = (lines: string[]) =>
  new Response(lines.map((line) => `${line}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });

// The model list, as GET /models gives it.
const modelList = (models: { id: string; max_tokens?: number }[]) =>
  Response.json({ data: models.map((m) => ({ type: 'model', display_name: m.id, ...m })), has_more: false, first_id: null, last_id: null });

// An error, in Anthropic's shape.
const apiError = (status: number, type: string, text: string) =>
  Response.json({ type: 'error', error: { type, message: text }, request_id: 'req_1' }, { status });

// Answers chat, stream and the model list.
const anyReply = (call: FetchCall): Response => {
  if (call.url.includes('/models')) return modelList([{ id: 'claude-opus-5-5', max_tokens: 128000 }, { id: 'claude-sonnet-5-5', max_tokens: 96000 }]);
  return call.body?.stream ? stream([messageStart, blockStart(1, 'text'), textDelta('OK'), blockStop(1), ...stopWith('end_turn')]) : message([{ type: 'text', text: 'OK' }]);
};

function connect(config: ProviderConfig = claude(), reply: (call: FetchCall) => Response | Promise<Response> = anyReply) {
  const { doFetch, calls } = fakeFetch(reply);
  return { provider: createAnthropicProvider(() => config, { fetch: doFetch }), calls };
}

// Reads a whole stream: its text, its thinking, and the error it ended with.
async function drain(provider: ReturnType<typeof connect>['provider'], req: ChatRequest) {
  const parts: { kind: string; text: string }[] = [];
  let error: Error | null = null;
  try {
    for await (const part of provider.chatStream(req)) parts.push(part);
  } catch (err) {
    error = err as Error;
  }
  const join = (kind: string) => parts.filter((p) => p.kind === kind).map((p) => p.text).join('');
  return { text: join('text'), thinking: join('thinking'), error };
}

// How many union-type parameters a schema has. A nullable field is one: a
// type list (["string", "null"]) or anyOf. Claude takes 16 at most.
function unions(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n: number, item) => n + unions(item), 0);
  if (!node || typeof node !== 'object') return 0;
  const own = Array.isArray((node as { type?: unknown }).type) || 'anyOf' in node || 'oneOf' in node ? 1 : 0;
  return own + Object.entries(node).reduce((n, [key, value]) => n + (key === 'enum' || key === 'const' ? 0 : unions(value)), 0);
}

// A fetch that never answers: it only ends when the request is aborted.
const never = (call: FetchCall) =>
  new Promise<Response>((_resolve, reject) => {
    call.signal?.addEventListener('abort', () => reject(call.signal!.reason as Error));
  });

describe('Claude connector: the request', () => {
  it('posts to /messages with the key, the version, the model, max_tokens and the system message as a cached block', async () => {
    const { provider, calls } = connect(claude({ baseUrl: 'https://api.anthropic.com/v1/' }));
    expect(await provider.chat(ask({ maxTokens: 300, temperature: 0.2, thinking: false }))).toEqual({ text: 'OK', thinking: '' });
    const call = calls[0]!;
    expect([call.method, call.url]).toEqual(['POST', 'https://api.anthropic.com/v1/messages']);
    expect(call.headers.get('x-api-key')).toBe(KEY);
    expect(call.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(call.headers.get('content-type')).toBe('application/json');
    // The key is not a Bearer token.
    expect(call.headers.has('authorization')).toBe(false);
    // Only Messages API fields. No temperature, top_p or top_k: current models refuse them.
    expect(call.body).toEqual({
      model: 'claude-sonnet-5-5',
      // Off counts as Medium for the ceiling (see the level table below).
      max_tokens: 300 + THINKING_TOKENS.medium,
      system: [{ type: 'text', text: 'You read job ads.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'The ad.' }],
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'low' },
    });
  });

  it('sends the other messages in order, and a request model wins over the settings model', async () => {
    const { provider, calls } = connect();
    await provider.chat({
      model: 'claude-haiku-5-5',
      messages: [
        { role: 'system', content: 'You read job ads.' },
        { role: 'user', content: 'The ad.' },
        { role: 'assistant', content: '{"title":' },
        { role: 'user', content: 'That answer was not valid. Reply again with only the JSON object.' },
      ],
    });
    expect(calls[0]!.body!.model).toBe('claude-haiku-5-5');
    expect(calls[0]!.body!.messages).toEqual([
      { role: 'user', content: 'The ad.' },
      { role: 'assistant', content: '{"title":' },
      { role: 'user', content: 'That answer was not valid. Reply again with only the JSON object.' },
    ]);
  });

  it('with no system message, sends no system field', async () => {
    const { provider, calls } = connect();
    await provider.chat({ messages: [{ role: 'user', content: 'Hi' }] });
    expect('system' in calls[0]!.body!).toBe(false);
  });

  it('asks for JSON by schema, with additionalProperties false on every object and no limits Claude refuses', async () => {
    const schema = {
      type: 'object',
      properties: {
        score: { type: 'integer', minimum: 0, maximum: 100 },
        why: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 }, minItems: 1, maxItems: 4 },
        ratio: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1, multipleOf: 0.01 },
        code: { type: 'string', pattern: '^[A-Z]+$' },
        // A property may be called "pattern" or "minimum": it stays.
        pattern: { type: 'string' },
        minimum: { type: 'number' },
        salary: { type: 'object', properties: { min: { type: ['number', 'null'] } }, required: ['min'] },
        contact: { anyOf: [{ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, { type: 'null' }] },
        verdict: { type: 'string', enum: ['strong', 'weak'] },
      },
      required: ['score', 'why'],
    };
    const before = structuredClone(schema);
    const { provider, calls } = connect(claude(), () => message([{ type: 'text', text: '{"score":70}' }]));
    expect(await provider.chat(ask({ jsonSchema: { name: 'rating', schema } }))).toEqual({ text: '{"score":70}', thinking: '' });
    expect(calls[0]!.body!.output_config).toEqual({
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            score: { type: 'integer' },
            why: { type: 'array', items: { type: 'string' } },
            ratio: { type: 'number' },
            code: { type: 'string' },
            pattern: { type: 'string' },
            minimum: { type: 'number' },
            salary: { type: 'object', properties: { min: { type: ['number', 'null'] } }, required: ['min'], additionalProperties: false },
            contact: {
              anyOf: [{ type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false }, { type: 'null' }],
            },
            verdict: { type: 'string', enum: ['strong', 'weak'] },
          },
          required: ['score', 'why'],
          additionalProperties: false,
        },
      },
      // Thinking off is the lowest effort.
      effort: 'low',
    });
    // The request's own schema is left alone (zod still checks every answer).
    expect(schema).toEqual(before);
  });

  it.each([
    ['a record-style object', { type: 'object', additionalProperties: { type: 'string' } }],
    ['an object open to any field', { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true }],
    ['an open object inside a list', { type: 'array', items: { type: 'object', additionalProperties: {} } }],
  ])("refuses a schema with %s, instead of quietly closing it, and sends nothing", async (_what, inner) => {
    const { provider, calls } = connect();
    const schema = { type: 'object', properties: { tags: inner }, required: ['tags'] };
    const err = await provider.chat(ask({ jsonSchema: { name: 'thing', schema } })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    // A fault in the app, not "can't reach Claude".
    expect(err).not.toBeInstanceOf(AiUnavailableError);
    expect((err as Error).message).toBe("The Claude connector can't send a schema with open-ended objects.");
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['ParsedJob', ParsedJob],
    ['Rating', Rating],
    ['CardRating', CardRating],
    ['EmailClassification', EmailClassification],
  ])("the %s schema Claude gets has at most 16 union-type parameters (Claude's limit)", async (name, zodSchema) => {
    const { provider, calls } = connect();
    await provider.chat(ask({ jsonSchema: { name, schema: toAiSchema(zodSchema as never) } }));
    const sent = (calls[0]!.body!.output_config as { format: { schema: unknown } }).format.schema;
    // So a new nullable field that would take it past 16 fails here, not at Claude.
    expect(unions(sent)).toBeLessThanOrEqual(16);
  });

  it('counts union-type parameters: a type list or anyOf, nested ones too', () => {
    const nullable = { type: ['string', 'null'] };
    expect(unions({ type: 'object', properties: { a: nullable, b: { anyOf: [{ type: 'object', properties: { c: nullable } }, { type: 'null' }] } } })).toBe(3);
  });

  it('JSON and thinking together keep both: the format and the effort', async () => {
    const { provider, calls } = connect();
    await provider.chat(ask({ maxTokens: 300, thinking: true, thinkingEffort: 'high', jsonSchema: { name: 'thing', schema: { type: 'object', properties: {} } } }));
    const body = calls[0]!.body!;
    expect(body.output_config).toEqual({
      format: { type: 'json_schema', schema: { type: 'object', properties: {}, additionalProperties: false } },
      effort: 'high',
    });
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(body.max_tokens).toBe(300 + THINKING_TOKENS.high);
  });

  it('maps each thinking level to adaptive thinking and an effort, with its own room on top of the longest answer', async () => {
    const { provider, calls } = connect();
    await provider.chat(ask({ maxTokens: 2048, thinking: false }));
    await provider.chat(ask({ maxTokens: 2048, thinking: true, thinkingEffort: 'low' }));
    await provider.chat(ask({ maxTokens: 2048, thinking: true, thinkingEffort: 'medium' }));
    await provider.chat(ask({ maxTokens: 2048, thinking: true, thinkingEffort: 'high' }));
    await provider.chat(ask({ maxTokens: 2048, thinking: true }));
    await provider.chat(ask({ maxTokens: 2048 }));
    expect(calls.map((c) => [c.body!.output_config, c.body!.max_tokens])).toEqual([
      // Off asks for effort low: Claude can't stop thinking on most current
      // models. For the ceiling, Off and Low count as Medium: max_tokens is
      // only a ceiling, and thinking at effort low may go past 512 tokens.
      [{ effort: 'low' }, 2048 + THINKING_TOKENS.medium],
      [{ effort: 'low' }, 2048 + THINKING_TOKENS.medium],
      [{ effort: 'medium' }, 2048 + THINKING_TOKENS.medium],
      [{ effort: 'high' }, 2048 + THINKING_TOKENS.high],
      [{ effort: 'medium' }, 2048 + THINKING_TOKENS.medium],
      [{ effort: 'low' }, 2048 + THINKING_TOKENS.medium],
    ]);
    // Never "disabled" and never budget_tokens: both get a 400 on current models.
    for (const call of calls) {
      expect(call.body!.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(JSON.stringify(call.body)).not.toMatch(/disabled|budget_tokens/);
    }
  });

  it("No limit asks for effort max, with the model's own max_tokens from GET /models, looked up once", async () => {
    const { provider, calls } = connect();
    await provider.chat(ask({ maxTokens: 8192, thinking: true, thinkingEffort: 'max' }));
    await provider.chat(ask({ maxTokens: 8192, thinking: true, thinkingEffort: 'max' }));
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', 'https://api.anthropic.com/v1/models?limit=1000'],
      ['POST', 'https://api.anthropic.com/v1/messages'],
      ['POST', 'https://api.anthropic.com/v1/messages'],
    ]);
    expect(calls[0]!.headers.get('x-api-key')).toBe(KEY);
    expect(calls[0]!.headers.get('anthropic-version')).toBe('2023-06-01');
    for (const call of calls.slice(1)) {
      expect(call.body).toMatchObject({ max_tokens: 96000, thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'max' } });
    }
  });

  it("No limit on a stream uses the model's own max_tokens too", async () => {
    const { provider, calls } = connect();
    expect((await drain(provider, ask({ maxTokens: 8192, thinking: true, thinkingEffort: 'max' }))).error).toBeNull();
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', 'https://api.anthropic.com/v1/models?limit=1000'],
      ['POST', 'https://api.anthropic.com/v1/messages'],
    ]);
    expect(calls[1]!.body).toMatchObject({ stream: true, max_tokens: 96000, output_config: { effort: 'max' } });
  });

  it('a cancel during the No limit model lookup stops the request', async () => {
    const { provider, calls } = connect(claude(), (call) => (call.url.includes('/models') ? never(call) : anyReply(call)));
    const controller = new AbortController();
    const pending = provider.chat(ask({ thinking: true, thinkingEffort: 'max' }), { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const err = await pending.catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('the time limit running out during the No limit model lookup stops the request', async () => {
    const { provider, calls } = connect(claude({ timeoutSec: 1 }), (call) => (call.url.includes('/models') ? never(call) : anyReply(call)));
    const err = await provider.chat(ask({ thinking: true, thinkingEffort: 'max' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe("Claude – mine at https://api.anthropic.com/v1 didn't answer within 1 seconds.");
    const streamed = await drain(provider, ask({ thinking: true, thinkingEffort: 'max' }));
    expect(streamed.error?.message).toBe('Claude – mine at https://api.anthropic.com/v1 sent nothing for 1 seconds.');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET']);
  });

  it("No limit uses 64000 when the model list doesn't know the model, or can't be read", async () => {
    const unknown = connect(claude({ model: 'claude-sonnet-9' }));
    await unknown.provider.chat(ask({ maxTokens: 8192, thinking: true, thinkingEffort: 'max' }));
    expect(unknown.calls[1]!.body!.max_tokens).toBe(64000);

    const broken = connect(claude(), (call) => (call.url.includes('/models') ? apiError(500, 'api_error', 'Internal server error') : anyReply(call)));
    await broken.provider.chat(ask({ maxTokens: 8192, thinking: true, thinkingEffort: 'max' }));
    expect(broken.calls[1]!.body!.max_tokens).toBe(64000);
  });

  it('extra fields go in last: a nested field changes only itself, and a null removes a field', async () => {
    const { provider, calls } = connect();
    await provider.chat(
      ask({
        thinking: false,
        jsonSchema: { name: 'thing', schema: { type: 'object', properties: {} } },
        extra: { output_config: { effort: 'xhigh' }, thinking: { display: null }, inference_geo: 'us' },
      }),
    );
    await provider.chat(ask({ extra: { thinking: null } }));
    const [first, second] = calls.map((c) => c.body!);
    expect(first!.output_config).toEqual({
      format: { type: 'json_schema', schema: { type: 'object', properties: {}, additionalProperties: false } },
      effort: 'xhigh',
    });
    expect(first!.thinking).toEqual({ type: 'adaptive' });
    expect(first!.inference_geo).toBe('us');
    expect('thinking' in second!).toBe(false);
    // The catalogue itself is never changed.
    expect(AI_PRESETS.anthropic.dialect.thinking).toMatchObject({ off: { thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'low' } } });
  });
});

describe('Claude connector: the answer', () => {
  it('keeps thinking blocks out of the text', async () => {
    const { provider } = connect(claude(), () =>
      message([
        { type: 'thinking', thinking: 'Weighing the ad.', signature: 'EqQBCgIYAhIM' },
        { type: 'redacted_thinking', data: 'EmwKAhgB' },
        { type: 'text', text: '{"score":' },
        { type: 'text', text: '70}' },
      ]),
    );
    expect(await provider.chat(ask())).toEqual({ text: '{"score":70}', thinking: 'Weighing the ad.' });
  });

  it('an answer that ran out of room says so', async () => {
    const { provider } = connect(claude(), () => message([{ type: 'thinking', thinking: 'Still weighing…', signature: 's' }], 'max_tokens'));
    const err = await provider.chat(ask({ maxTokens: 300 })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(CUT_OFF);
  });

  it("an answer that filled the model's context says so, without asking for a longer answer", async () => {
    const { provider } = connect(claude(), (call) =>
      call.body!.stream
        ? stream([messageStart, textDelta('Dear hiring'), ...stopWith('model_context_window_exceeded')])
        : message([], 'model_context_window_exceeded'),
    );
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(CONTEXT_FULL);
    const streamed = await drain(provider, ask());
    expect(streamed.text).toBe('Dear hiring');
    expect(streamed.error?.message).toBe(CONTEXT_FULL);
  });

  it('a refusal says so, on chat and on a stream after the text so far', async () => {
    const { provider } = connect(claude(), (call) =>
      call.body!.stream ? stream([messageStart, textDelta('Dear hiring'), ...stopWith('refusal')]) : message([], 'refusal'),
    );
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(DECLINED);
    const streamed = await drain(provider, ask());
    expect(streamed.text).toBe('Dear hiring');
    expect(streamed.error).toBeInstanceOf(AiRefusedError);
    expect(streamed.error?.message).toBe(DECLINED);
  });

  it('streams text_delta as text and thinking_delta as thinking, skipping signature_delta and ping', async () => {
    const { provider, calls } = connect(claude(), () =>
      stream([
        messageStart,
        ping,
        blockStart(0, 'thinking'),
        thinkingDelta('Weighing '),
        thinkingDelta('the ad.'),
        signatureDelta,
        blockStop(0),
        blockStart(1, 'text'),
        textDelta('Dear '),
        ping,
        textDelta('hiring manager'),
        blockStop(1),
        ...stopWith('end_turn'),
      ]),
    );
    expect(await drain(provider, ask({ maxTokens: 8192, thinking: true, thinkingEffort: 'low' }))).toEqual({
      text: 'Dear hiring manager',
      thinking: 'Weighing the ad.',
      error: null,
    });
    expect(calls[0]!.body).toMatchObject({ stream: true, max_tokens: 8192 + THINKING_TOKENS.medium, output_config: { effort: 'low' } });
  });

  it('a stream ends at message_stop (there is no [DONE])', async () => {
    const { provider } = connect(claude(), () => stream([messageStart, textDelta('Hello'), ...stopWith('end_turn'), textDelta(' and more')]));
    expect(await drain(provider, ask())).toEqual({ text: 'Hello', thinking: '', error: null });
  });

  it('a stream that closes before message_stop, with no stop reason, says it stopped early, after the text so far', async () => {
    const replies = [
      stream([messageStart, textDelta('Half a '), textDelta('cover letter')]),
      // A stop reason means the answer was finished, even if message_stop never came.
      stream([messageStart, textDelta('A whole cover letter'), stopWith('end_turn')[0]!]),
    ];
    let i = 0;
    const { provider } = connect(claude(), () => replies[i++]!);
    const cut = await drain(provider, ask());
    expect(cut.text).toBe('Half a cover letter');
    expect(cut.error).toBeInstanceOf(AiRefusedError);
    expect(cut.error?.message).toBe(STOPPED_SENDING);
    expect(await drain(provider, ask())).toEqual({ text: 'A whole cover letter', thinking: '', error: null });
  });

  it('a streamed answer cut off by max_tokens ends with the cut-off sentence, after the text so far', async () => {
    const { provider } = connect(claude(), () => stream([messageStart, textDelta('Half a '), textDelta('resume'), ...stopWith('max_tokens')]));
    const streamed = await drain(provider, ask());
    expect(streamed.text).toBe('Half a resume');
    expect(streamed.error).toBeInstanceOf(AiRefusedError);
    expect(streamed.error?.message).toBe(CUT_OFF);
  });

  it('an error event mid-stream ends it after the text so far, with its sentence and without the key', async () => {
    const replies = [
      stream([messageStart, textDelta('Half a '), event({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })]),
      stream([messageStart, textDelta('Half a '), event({ type: 'error', error: { type: 'api_error', message: `Internal error (${KEY})` } })]),
    ];
    let i = 0;
    const { provider } = connect(claude(), () => replies[i++]!);
    const busy = await drain(provider, ask());
    expect(busy.text).toBe('Half a ');
    // Busy is about Claude as a whole, not this request.
    expect(busy.error).toBeInstanceOf(AiAccountError);
    expect(busy.error?.message).toBe(BUSY);
    const other = await drain(provider, ask());
    expect(other.text).toBe('Half a ');
    expect(other.error?.message).toBe('Claude – mine at https://api.anthropic.com/v1 stopped with an error: Internal error ([key hidden])');
  });
});

describe('Claude connector: health, keys and errors', () => {
  it('health lists the models from GET /models, with the key', async () => {
    const { provider, calls } = connect();
    expect(await provider.health()).toEqual({ ok: true, models: ['claude-opus-5-5', 'claude-sonnet-5-5'], detail: null });
    expect(calls.map((c) => [c.method, c.url, c.headers.get('x-api-key'), c.headers.get('anthropic-version')])).toEqual([
      ['GET', 'https://api.anthropic.com/v1/models?limit=1000', KEY, '2023-06-01'],
    ]);
  });

  it('with no key saved, says so without calling Claude', async () => {
    const { provider, calls } = connect(claude({ apiKey: null }));
    const err = await provider.chat(ask({ thinking: true, thinkingEffort: 'max' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiAccountError);
    expect((err as Error).message).toBe(NEEDS_KEY);
    const streamed = await drain(provider, ask());
    expect(streamed.error).toBeInstanceOf(AiAccountError);
    expect(streamed.error?.message).toBe(NEEDS_KEY);
    expect(await provider.health()).toEqual({ ok: false, models: [], detail: NEEDS_KEY });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['401', () => apiError(401, 'authentication_error', 'invalid x-api-key'), KEY_REFUSED],
    ['402', () => apiError(402, 'billing_error', 'Your credit balance is too low to access the Anthropic API.'), LIMIT],
    ['429', () => apiError(429, 'rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit.'), LIMIT],
    [
      '400 about a spend limit',
      () => apiError(400, 'invalid_request_error', 'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.'),
      LIMIT,
    ],
    ['529', () => apiError(529, 'overloaded_error', 'Overloaded'), BUSY],
  ])('a %s gives its plain sentence, naming the AI, on chat, stream and health', async (_what, reply, sentence) => {
    const { provider } = connect(claude(), reply);
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    // About Claude as a whole, not this request, so waiting work keeps waiting.
    expect(err).toBeInstanceOf(AiAccountError);
    expect(err).not.toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(sentence);
    expect((await drain(provider, ask())).error?.message).toBe(sentence);
    expect(await provider.health()).toEqual({ ok: false, models: [], detail: sentence });
  });

  it('an error that echoes the key never shows it (Review Focus 2)', async () => {
    const { provider } = connect(claude(), () => apiError(404, 'not_found_error', `model: ${KEY}`));
    const err = (await provider.chat(ask()).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(AiRefusedError);
    expect(err.message).toBe('Claude – mine at https://api.anthropic.com/v1 answered with an error (404): model: [key hidden]');
    expect((await drain(provider, ask())).error?.message).not.toContain(KEY);
    expect((await provider.health()).detail).not.toContain(KEY);
  });

  it("can't reach Claude: names the AI and its address", async () => {
    const { provider } = connect(claude(), () => Promise.reject(new TypeError('fetch failed')));
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err).not.toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(
      "Can't reach Claude – mine at https://api.anthropic.com/v1. Check that it's running, or pick another AI in Settings.",
    );
  });

  it('a whole answer must come within the time limit', async () => {
    const { provider } = connect(claude({ timeoutSec: 1 }), never);
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe("Claude – mine at https://api.anthropic.com/v1 didn't answer within 1 seconds.");
  });

  it('a stream that keeps sending may take longer than the time limit', async () => {
    const { provider } = connect(claude({ timeoutSec: 1 }), (call) =>
      slowStream(call.signal, [
        [0, messageStart],
        ...Array.from({ length: 5 }, (): [number, string] => [400, ping]),
        [0, textDelta('Done thinking.')],
        ...stopWith('end_turn').map((line): [number, string] => [0, line]),
      ]),
    );
    expect(await drain(provider, ask())).toEqual({ text: 'Done thinking.', thinking: '', error: null });
  });

  it('a stream that sends nothing new for the time limit stops with the name, the address and the limit', async () => {
    const { provider } = connect(claude({ timeoutSec: 1 }), (call) =>
      slowStream(call.signal, [
        [0, messageStart],
        [0, textDelta('Half')],
        [1500, textDelta(' more')],
        ...stopWith('end_turn').map((line): [number, string] => [0, line]),
      ]),
    );
    const streamed = await drain(provider, ask());
    expect(streamed.text).toBe('Half');
    expect(streamed.error).toBeInstanceOf(AiRefusedError);
    expect(streamed.error?.message).toBe('Claude – mine at https://api.anthropic.com/v1 sent nothing for 1 seconds.');
  });

  it('cancelling aborts the request', async () => {
    const { provider } = connect(claude(), never);
    const controller = new AbortController();
    const pending = provider.chat(ask(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const err = await pending.catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
  });
});
