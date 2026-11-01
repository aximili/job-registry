import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AI_PRESETS, AiPresetId, THINKING_TOKENS, type ThinkingMap } from '../../../../shared/contracts/index.ts';
import { fakeFetch, slowStream, type FetchCall as Call } from '../../../../tests/fakes/fake-fetch.ts';
import { startFakeOpenAiServer, type FakeHandler, type FakeOpenAiServer } from '../../../../tests/fakes/fake-openai-server.ts';
import { AiAccountError, AiRefusedError, AiUnavailableError } from '../../../core/errors.ts';
import type { ChatRequest, ProviderConfig } from '../provider.ts';
import { createOpenAiCompatibleProvider } from './openai-compatible.ts';

let server: FakeOpenAiServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function setup(handler?: FakeHandler, config: { model?: string; timeoutSec?: number } = {}) {
  server = await startFakeOpenAiServer(handler);
  const provider = createOpenAiCompatibleProvider(() =>
    local({ baseUrl: server!.url, model: config.model ?? 'qwen3:8b', timeoutSec: config.timeoutSec ?? 10 }),
  );
  return { provider, server };
}

// Bonsai 2 on this computer: no key, and the llama-server fields.
const local = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  name: 'Bonsai 2',
  preset: 'llama-server',
  baseUrl: 'http://127.0.0.1:8080/v1',
  model: '',
  timeoutSec: 10,
  apiKey: null,
  dialect: AI_PRESETS['llama-server'].dialect,
  ...over,
});

const ask =(extra: Partial<ChatRequest> = {}): ChatRequest => ({
  messages: [
    { role: 'system', content: 'You read job ads.' },
    { role: 'user', content: 'The ad.' },
  ],
  ...extra,
});

const CUT_OFF =
  "The AI ran out of room before it finished. In Settings → AI, give this task less thinking or a longer answer, then try again. If that doesn't help, the AI server's context is full: give it a bigger one (llama-server's -c).";

async function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

describe('OpenAI-compatible provider', () => {
  it('sends one system message first, the model, max_tokens and the JSON schema', async () => {
    const { provider, server } = await setup(() => ({ content: '{"a":1}' }));
    const res = await provider.chat(ask({ maxTokens: 300, temperature: 0.2, jsonSchema: { name: 'thing', schema: { type: 'object' } } }));
    expect(res.text).toBe('{"a":1}');
    const body = server.requests[0]!;
    expect(body.model).toBe('qwen3:8b');
    expect(body.max_tokens).toBe(300);
    expect(body.temperature).toBe(0.2);
    expect(body.stream).toBe(false);
    expect((body.messages as { role: string }[]).map((m) => m.role)).toEqual(['system', 'user']);
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'thing', schema: { type: 'object' }, strict: true } });
  });

  it('a request model wins over the settings model', async () => {
    const { provider, server } = await setup();
    await provider.chat(ask({ model: 'small' }));
    expect(server.requests[0]!.model).toBe('small');
  });

  it('turns thinking off with reasoning_effort "none", and on with the task effort', async () => {
    const { provider, server } = await setup();
    await provider.chat(ask({ thinking: false }));
    await provider.chat(ask({ thinking: true }));
    await provider.chat(ask({ thinking: true, thinkingEffort: 'low' }));
    await provider.chat(ask({ thinking: true, thinkingEffort: 'high' }));
    await provider.chat(ask());
    // Bonsai 2 refuses "high": its strongest effort is "xhigh".
    expect(server.requests.map((r) => r.reasoning_effort)).toEqual(['none', 'medium', 'low', 'xhigh', undefined]);
  });

  it('gives each thinking level its own room, on top of the longest answer', async () => {
    const { provider, server } = await setup();
    await provider.chat(ask({ maxTokens: 2048, thinking: false }));
    await provider.chat(ask({ maxTokens: 2048, thinking: true, thinkingEffort: 'low' }));
    await provider.chat(ask({ maxTokens: 2048, thinking: true, thinkingEffort: 'medium' }));
    await provider.chat(ask({ maxTokens: 2048, thinking: true, thinkingEffort: 'high' }));
    expect(server.requests.map((r) => [r.thinking_budget_tokens, r.max_tokens])).toEqual([
      [undefined, 2048],
      [512, 2048 + 512],
      [2048, 2048 + 2048],
      [8192, 2048 + 8192],
    ]);
  });

  it('thinking with no limit sends no effort and no limits, so the AI uses its own default', async () => {
    const { provider, server } = await setup();
    await provider.chat(ask({ maxTokens: 8192, temperature: 0.6, thinking: true, thinkingEffort: 'max' }));
    const body = server.requests[0]!;
    expect(body.temperature).toBe(0.6);
    for (const field of ['reasoning_effort', 'thinking_budget_tokens', 'max_tokens']) expect(field in body).toBe(false);
  });

  it('extra fields are sent as they are, and a null removes a field', async () => {
    const { provider, server } = await setup();
    await provider.chat(ask({ thinking: false, extra: { top_k: 20, reasoning_effort: null } }));
    expect(server.requests[0]!.top_k).toBe(20);
    expect('reasoning_effort' in server.requests[0]!).toBe(false);
  });

  it('keeps thinking out of the text: reasoning_content, reasoning and <think> blocks', async () => {
    const replies = [
      { content: 'Answer one', reasoning: 'Thought one' },
      { content: 'Answer two', reasoning: 'Thought two', reasoningField: 'reasoning' as const },
      { content: '<think>Thought three</think>\nAnswer three' },
    ];
    let i = 0;
    const { provider } = await setup(() => replies[i++]!);
    const results = [await provider.chat(ask()), await provider.chat(ask()), await provider.chat(ask())];
    expect(results.map((r) => r.text)).toEqual(['Answer one', 'Answer two', 'Answer three']);
    expect(results.map((r) => r.thinking)).toEqual(['Thought one', 'Thought two', 'Thought three']);
  });

  it('streams text and thinking chunks separately', async () => {
    const { provider, server } = await setup(() => ({ content: 'A long streamed answer', reasoning: 'Hmm' }));
    const parts: { kind: string; text: string }[] = [];
    for await (const chunk of provider.chatStream(ask())) parts.push(chunk);
    expect(server.requests[0]!.stream).toBe(true);
    expect(parts.filter((p) => p.kind === 'thinking').map((p) => p.text).join('')).toBe('Hmm');
    expect(parts.filter((p) => p.kind === 'text').map((p) => p.text).join('')).toBe('A long streamed answer');
  });

  it('a <think> block split across stream chunks still stays out of the text', async () => {
    const { provider } = await setup(() => ({ content: 'Start <think>a private thought</think>and the answer' }));
    const parts: { kind: string; text: string }[] = [];
    for await (const chunk of provider.chatStream(ask())) parts.push(chunk);
    expect(parts.filter((p) => p.kind === 'text').map((p) => p.text).join('')).toBe('Start and the answer');
    expect(parts.filter((p) => p.kind === 'thinking').map((p) => p.text).join('')).toBe('a private thought');
  });

  it('a streamed answer cut off by max_tokens ends with an error, after the text so far', async () => {
    const { provider } = await setup(() => ({ content: 'Half a resume', finishReason: 'length' }));
    const parts: string[] = [];
    const run = async () => {
      for await (const chunk of provider.chatStream(ask())) if (chunk.kind === 'text') parts.push(chunk.text);
    };
    await expect(run()).rejects.toThrow(new AiRefusedError(CUT_OFF));
    expect(parts.join('')).toBe('Half a resume');
  });

  it('an answer cut off while the AI was still thinking says so, and gives no half answer', async () => {
    const { provider } = await setup(() => ({ content: '', reasoning: 'Let me weigh this job against the profile…', finishReason: 'length' }));
    const err = await provider.chat(ask({ maxTokens: 2048, thinking: true, thinkingEffort: 'low' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(CUT_OFF);
  });

  it('a stream that keeps sending may take longer than the time limit', async () => {
    const { provider } = await setup(() => ({ content: 'A resume, written slowly.', reasoning: 'Hmm', chunkDelayMs: 300 }), { timeoutSec: 1 });
    let text = '';
    for await (const chunk of provider.chatStream(ask())) if (chunk.kind === 'text') text += chunk.text;
    expect(text).toBe('A resume, written slowly.');
  });

  it('a stream that goes quiet for the time limit stops with the name, the address and the limit', async () => {
    const { provider, server } = await setup(() => ({ content: 'Stalled', chunkDelayMs: 1500 }), { timeoutSec: 1 });
    const run = async () => {
      for await (const chunk of provider.chatStream(ask())) void chunk;
    };
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(`Bonsai 2 at ${server.url} sent nothing for 1 seconds.`);
  });

  it('a wrong address (no /v1) names the AI and the address in the error', async () => {
    server = await startFakeOpenAiServer();
    const provider = createOpenAiCompatibleProvider(() => local({ baseUrl: server!.origin, model: 'm', timeoutSec: 5 }));
    const health = await provider.health();
    expect(health).toEqual({ ok: false, models: [], detail: `Bonsai 2 at ${server.origin} answered with an error (404): Not found` });
  });

  it("health lists the server's models", async () => {
    const { provider } = await setup();
    expect(await provider.health()).toEqual({ ok: true, models: ['fake-model'], detail: null });
  });

  it('a server that is not running gives a plain "Can\'t reach Bonsai 2 at …" error', async () => {
    const port = await closedPort();
    const provider = createOpenAiCompatibleProvider(() => local({ baseUrl: `http://127.0.0.1:${port}/v1`, timeoutSec: 5 }));
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err).not.toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(
      `Can't reach Bonsai 2 at http://127.0.0.1:${port}/v1. Check that it's running, or pick another AI in Settings.`,
    );
    const health = await provider.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain("Can't reach Bonsai 2");
  });

  it('a slow server times out with the name, the address and the time limit', async () => {
    const { provider, server } = await setup(() => ({ content: 'late', delayMs: 1500 }), { timeoutSec: 1 });
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(`Bonsai 2 at ${server.url} didn't answer within 1 seconds.`);
  });

  it("an HTTP 500 shows the server's own message, with the AI's name", async () => {
    const { provider, server } = await setup(() => ({ status: 500, error: 'reasoning_effort "high" is not supported' }));
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(`Bonsai 2 at ${server.url} answered with an error (500): reasoning_effort "high" is not supported`);
  });

  it('cancelling aborts the request', async () => {
    const { provider } = await setup(() => ({ content: 'late', delayMs: 2000 }));
    const controller = new AbortController();
    const pending = provider.chat(ask(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    const err = await pending.catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
  });
});

// A whole answer, as /chat/completions gives it.
const answer = (content: unknown) =>
  Response.json({ choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });

// A streamed answer: each line as it is, then [DONE].
const stream = (lines: string[]) =>
  new Response(`${lines.map((line) => `${line}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const chunk = (delta: Record<string, unknown>, finishReason?: string, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ ...extra, choices: [{ index: 0, delta, finish_reason: finishReason ?? null }] })}`;

const CLOUD_CUT_OFF = 'My AI ran out of room before it finished. In Settings → AI, give this task less thinking or a longer answer, then try again.';

// Answers chat, stream and the model list.
const anyReply = (call: Call): Response => {
  if (call.url.endsWith('/models')) return Response.json({ data: [{ id: 'm' }] });
  return call.body?.stream ? stream([chunk({ content: 'OK' }), chunk({}, 'stop')]) : answer('OK');
};

// A cloud AI with a key.
const cloud = (preset: AiPresetId, over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  name: 'My AI',
  preset,
  baseUrl: 'https://ai.example/v1',
  model: 'm',
  timeoutSec: 10,
  apiKey: 'sk-1',
  dialect: AI_PRESETS[preset].dialect,
  ...over,
});

function connect(config: ProviderConfig, reply: (call: Call) => Response = anyReply) {
  const { doFetch, calls } = fakeFetch(reply);
  return { provider: createOpenAiCompatibleProvider(() => config, { fetch: doFetch }), calls };
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

// Every cloud preset that speaks OpenAI-style (Claude has its own connector).
const CLOUD = AiPresetId.options.filter((id) => AI_PRESETS[id].group === 'cloud' && AI_PRESETS[id].dialect.connector === 'openai');

describe('OpenAI-compatible provider: keys, dialects and plain errors', () => {
  it('sends the key as a Bearer token on chat, stream and the model list', async () => {
    const { provider, calls } = connect(cloud('openai'));
    await provider.chat(ask());
    await drain(provider, ask());
    expect(await provider.health()).toEqual({ ok: true, models: ['m'], detail: null });
    expect(calls.map((c) => [c.method, c.url, c.headers.get('authorization')])).toEqual([
      ['POST', 'https://ai.example/v1/chat/completions', 'Bearer sk-1'],
      ['POST', 'https://ai.example/v1/chat/completions', 'Bearer sk-1'],
      ['GET', 'https://ai.example/v1/models', 'Bearer sk-1'],
    ]);
  });

  it('sends no authorization header without a key', async () => {
    const { provider, calls } = connect(cloud('custom', { apiKey: null }));
    await provider.chat(ask());
    await drain(provider, ask());
    await provider.health();
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.headers.has('authorization')).toBe(false);
    expect(calls[0]!.headers.get('content-type')).toBe('application/json');
  });

  it('every cloud preset but Claude uses this connector', () => {
    expect(CLOUD).toEqual(['openai', 'gemini', 'deepseek', 'kimi', 'zai', 'qwen', 'mistral', 'xai', 'groq', 'openrouter']);
  });

  // Off still thinks a little on many cloud models ("low", "minimal"), so it
  // gets Medium's room on top of the longest answer, as Claude does.
  it.each(CLOUD)('%s: the body for thinking off, Low and No limit', async (preset) => {
    const { dialect } = AI_PRESETS[preset];
    const thinking = dialect.thinking as ThinkingMap;
    const { provider, calls } = connect(cloud(preset));
    await provider.chat(ask({ maxTokens: 512, temperature: 0.2, thinking: false }));
    await provider.chat(ask({ maxTokens: 512, temperature: 0.2, thinking: true, thinkingEffort: 'low' }));
    await provider.chat(ask({ maxTokens: 512, temperature: 0.2, thinking: true, thinkingEffort: 'max' }));
    const base = { model: 'm', messages: ask().messages, stream: false, ...(dialect.temperature ? { temperature: 0.2 } : {}) };
    expect(calls.map((c) => c.body)).toEqual([
      { ...base, ...thinking.off, [dialect.maxTokens]: 512 + THINKING_TOKENS.medium },
      { ...base, ...thinking.low, [dialect.maxTokens]: 512 + THINKING_TOKENS.low },
      // No limit: the AI thinks and writes as long as it likes.
      { ...base, ...thinking.max },
    ]);
  });

  it('for example, DeepSeek at Low', async () => {
    const { provider, calls } = connect(cloud('deepseek'));
    await provider.chat(ask({ maxTokens: 512, temperature: 0.2, thinking: true, thinkingEffort: 'low' }));
    expect(calls[0]!.body).toEqual({
      model: 'm',
      messages: ask().messages,
      stream: false,
      temperature: 0.2,
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
      max_tokens: 1024,
    });
  });

  it('Medium and High get their own room on top of the longest answer; no thinking setting is off, with Medium\'s room', async () => {
    const { provider, calls } = connect(cloud('openai'));
    await provider.chat(ask({ maxTokens: 512, thinking: true, thinkingEffort: 'medium' }));
    await provider.chat(ask({ maxTokens: 512, thinking: true, thinkingEffort: 'high' }));
    await provider.chat(ask({ maxTokens: 512, thinking: true }));
    await provider.chat(ask({ maxTokens: 512 }));
    expect(calls.map((c) => [c.body!.reasoning_effort, c.body!.max_completion_tokens])).toEqual([
      ['medium', 512 + THINKING_TOKENS.medium],
      ['high', 512 + THINKING_TOKENS.high],
      ['medium', 512 + THINKING_TOKENS.medium],
      ['low', 512 + THINKING_TOKENS.medium],
    ]);
  });

  it('the llama-server body is as it was before Phase 8', async () => {
    const { provider, calls } = connect(local());
    await provider.chat(ask({ maxTokens: 512, temperature: 0.2, thinking: false }));
    await provider.chat(ask({ maxTokens: 512, temperature: 0.2, thinking: true, thinkingEffort: 'low' }));
    await provider.chat(ask({ maxTokens: 512, temperature: 0.2, thinking: true, thinkingEffort: 'max' }));
    const base = { model: 'default', messages: ask().messages, stream: false, temperature: 0.2 };
    expect(calls.map((c) => c.body)).toEqual([
      { ...base, max_tokens: 512, reasoning_effort: 'none' },
      { ...base, max_tokens: 512 + 512, reasoning_effort: 'low', thinking_budget_tokens: 512 },
      base,
    ]);
  });

  it('json "object" asks for json_object, and writes the schema at the end of the system message', async () => {
    const schema = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] };
    const { provider, calls } = connect(cloud('deepseek'), () => answer('{"a":1}'));
    const req = ask({ jsonSchema: { name: 'thing', schema } });
    await provider.chat(req);
    await provider.chat(req);
    const body = calls[0]!.body!;
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages).toEqual([
      { role: 'system', content: `You read job ads.\n\nReply in json: one object that matches this JSON Schema:\n${JSON.stringify(schema)}` },
      { role: 'user', content: 'The ad.' },
    ]);
    // The request itself is left alone, so a second try doesn't add it twice.
    expect(calls[1]!.body!.messages).toEqual(body.messages);
    expect(req.messages[0]!.content).toBe('You read job ads.');
  });

  it('json "object" with no system message adds one', async () => {
    const { provider, calls } = connect(cloud('qwen'));
    await provider.chat({ messages: [{ role: 'user', content: 'Hi' }], jsonSchema: { name: 'thing', schema: { type: 'object' } } });
    expect(calls[0]!.body!.messages).toEqual([
      { role: 'system', content: 'Reply in json: one object that matches this JSON Schema:\n{"type":"object"}' },
      { role: 'user', content: 'Hi' },
    ]);
  });

  it('json "schema" sends the JSON schema and leaves the messages alone', async () => {
    const { provider, calls } = connect(cloud('openai'));
    await provider.chat(ask({ jsonSchema: { name: 'thing', schema: { type: 'object' } } }));
    expect(calls[0]!.body!.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'thing', schema: { type: 'object' }, strict: true } });
    expect(calls[0]!.body!.messages).toEqual(ask().messages);
  });

  it('max_completion_tokens takes the place of max_tokens, and temperature is left out where the provider refuses it', async () => {
    const { provider, calls } = connect(cloud('openai'));
    await provider.chat(ask({ maxTokens: 300, temperature: 0.2, thinking: false }));
    const body = calls[0]!.body!;
    // Off on a cloud AI: the answer plus Medium's room for the little thinking it still does.
    expect(body.max_completion_tokens).toBe(300 + THINKING_TOKENS.medium);
    expect('max_tokens' in body).toBe(false);
    expect('temperature' in body).toBe(false);
  });

  it('Z.ai gets a temperature of 1 at most', async () => {
    const { provider, calls } = connect(cloud('zai'));
    await provider.chat(ask({ temperature: 1.5 }));
    await provider.chat(ask({ temperature: 0.4 }));
    expect(calls.map((c) => c.body!.temperature)).toEqual([1, 0.4]);
  });

  it('extra fields still win last, and a null still removes a field', async () => {
    const { provider, calls } = connect(cloud('openai'));
    await provider.chat(
      ask({ maxTokens: 300, thinking: false, extra: { temperature: 0.7, reasoning_effort: 'high', max_completion_tokens: null, top_p: 0.9 } }),
    );
    const body = calls[0]!.body!;
    expect(body).toMatchObject({ temperature: 0.7, reasoning_effort: 'high', top_p: 0.9 });
    expect('max_completion_tokens' in body).toBe(false);
  });

  it('a preset that needs a key, with none saved, says so without calling the AI', async () => {
    const { provider, calls } = connect(cloud('openai', { name: 'OpenAI – mine', apiKey: null }));
    const sentence = 'OpenAI – mine needs an API key. Add it in Settings → AI.';
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiAccountError);
    expect((err as Error).message).toBe(sentence);
    const streamed = await drain(provider, ask());
    expect(streamed.error).toBeInstanceOf(AiAccountError);
    expect(streamed.error?.message).toBe(sentence);
    expect(await provider.health()).toEqual({ ok: false, models: [], detail: sentence });
    expect(calls).toHaveLength(0);
  });

  it("Mistral's content as a list: the text parts are the answer, and the thinking parts the thinking", async () => {
    const { provider } = connect(cloud('mistral'), (call) =>
      call.body!.stream
        ? stream([
            chunk({ role: 'assistant', content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'Weighing ' }] }] }),
            chunk({ content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'the ad.' }] }] }),
            chunk({ content: [{ type: 'text', text: '{"a":' }] }),
            chunk({ content: '1}' }),
            chunk({}, 'stop'),
          ])
        : answer([
            { type: 'thinking', thinking: [{ type: 'text', text: 'Weighing the ad.' }] },
            { type: 'text', text: '{"a":1}' },
          ]),
    );
    expect(await provider.chat(ask())).toEqual({ text: '{"a":1}', thinking: 'Weighing the ad.' });
    expect(await drain(provider, ask())).toEqual({ text: '{"a":1}', thinking: 'Weighing the ad.', error: null });
  });

  it('a stream with OpenRouter\'s ": OPENROUTER PROCESSING" lines still works', async () => {
    const { provider } = connect(cloud('openrouter'), () =>
      stream([': OPENROUTER PROCESSING', ': OPENROUTER PROCESSING', chunk({ content: 'Hello' }), chunk({}, 'stop')]),
    );
    expect(await drain(provider, ask())).toEqual({ text: 'Hello', thinking: '', error: null });
  });

  it('an error inside a stream (after HTTP 200) ends it after the text so far, naming the AI and hiding the key', async () => {
    const config = cloud('openrouter', { name: 'OpenRouter – mine', baseUrl: 'https://openrouter.ai/api/v1' });
    const { provider } = connect(config, () =>
      stream([
        chunk({ content: 'Half a ' }),
        chunk({ content: 'cover letter' }),
        chunk({ content: '' }, 'error', { error: { code: 'server_error', message: 'Provider disconnected (key sk-1)' } }),
      ]),
    );
    const streamed = await drain(provider, ask());
    expect(streamed.text).toBe('Half a cover letter');
    expect(streamed.error).toBeInstanceOf(AiRefusedError);
    expect(streamed.error?.message).toBe(
      'OpenRouter – mine at https://openrouter.ai/api/v1 stopped with an error: Provider disconnected (key [key hidden])',
    );
  });

  it('a chunk that says "error": null is not an error', async () => {
    const { provider } = connect(cloud('openrouter'), () =>
      stream([chunk({ content: 'Hello' }, undefined, { error: null }), chunk({}, 'stop', { error: null })]),
    );
    expect(await drain(provider, ask())).toEqual({ text: 'Hello', thinking: '', error: null });
  });

  it('a stream line that is JSON but not an object ("data: null") is skipped', async () => {
    const { provider } = connect(cloud('openrouter'), () => stream(['data: null', 'data: 42', chunk({ content: 'Hello' }), chunk({}, 'stop')]));
    expect(await drain(provider, ask())).toEqual({ text: 'Hello', thinking: '', error: null });
  });

  it("OpenRouter's comment lines keep a stream alive past the time limit, while the AI thinks", async () => {
    const { provider } = connect(cloud('openrouter', { timeoutSec: 1 }), (call) =>
      slowStream(call.signal, [
        ...Array.from({ length: 5 }, (): [number, string] => [400, ': OPENROUTER PROCESSING']),
        [0, chunk({ content: 'Done thinking.' })],
        [0, chunk({}, 'stop')],
        [0, 'data: [DONE]'],
      ]),
    );
    expect(await drain(provider, ask())).toEqual({ text: 'Done thinking.', thinking: '', error: null });
  });

  it("a whole answer with an error after HTTP 200 throws the provider's error, named and without the key", async () => {
    const replies = [
      Response.json({ error: { code: 502, message: 'Upstream went away (sk-1)' }, choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'error' }] }),
      Response.json({ error: { message: 'Upstream went away (sk-1)' } }),
      Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'error' }] }),
    ];
    let i = 0;
    const { provider } = connect(cloud('openrouter'), () => replies[i++]!);
    const messages = [];
    for (let n = 0; n < replies.length; n++) {
      const err = await provider.chat(ask()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiRefusedError);
      messages.push((err as Error).message);
    }
    expect(messages).toEqual([
      'My AI at https://ai.example/v1 stopped with an error: Upstream went away ([key hidden])',
      'My AI at https://ai.example/v1 stopped with an error: Upstream went away ([key hidden])',
      'My AI at https://ai.example/v1 stopped with an error: no details',
    ]);
  });

  it('a whole answer that says "error": null is a normal answer', async () => {
    const { provider } = connect(cloud('openrouter'), () =>
      Response.json({ error: null, choices: [{ index: 0, message: { role: 'assistant', content: 'Fine' }, finish_reason: 'stop' }] }),
    );
    expect(await provider.chat(ask())).toEqual({ text: 'Fine', thinking: '' });
  });

  it('a cloud AI that runs out of room says so without mentioning llama-server', async () => {
    const { provider } = connect(cloud('openai'), (call) =>
      call.body!.stream
        ? stream([chunk({ content: 'Half a resume' }), chunk({}, 'length')])
        : Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'length' }] }),
    );
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(CLOUD_CUT_OFF);
    const streamed = await drain(provider, ask());
    expect(streamed.text).toBe('Half a resume');
    expect(streamed.error?.message).toBe(CLOUD_CUT_OFF);
  });

  it("a local AI that runs out of room keeps today's sentence, with llama-server's -c", async () => {
    const { provider } = connect(local(), () =>
      Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'length' }] }),
    );
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    expect((err as Error).message).toBe(CUT_OFF);
  });

  it('an AI with no model list is healthy without being asked', async () => {
    const { provider, calls } = connect(cloud('zai'));
    expect(await provider.health()).toEqual({ ok: true, models: [], detail: null });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, 'OpenAI – mine refused its API key. Check the key in Settings → AI.'],
    [429, "OpenAI – mine says you've reached a usage limit. Wait a while, or switch to another AI from the AI pill at the top."],
    [503, 'OpenAI – mine is busy right now. Try again in a minute.'],
  ])('a %i gives its plain sentence, naming the AI, on chat, stream and health', async (status, sentence) => {
    const { provider } = connect(cloud('openai', { name: 'OpenAI – mine' }), () => Response.json({ error: { message: 'No.' } }, { status }));
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    // About the AI as a whole, not this request, so waiting work keeps waiting.
    expect(err).toBeInstanceOf(AiAccountError);
    expect(err).not.toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(sentence);
    expect((await drain(provider, ask())).error?.message).toBe(sentence);
    expect(await provider.health()).toEqual({ ok: false, models: [], detail: sentence });
  });

  it('a provider error that echoes the key never shows it (Review Focus 2)', async () => {
    const { provider } = connect(cloud('openai'), () => new Response('{"error":"bad key sk-1"}', { status: 400 }));
    const err = (await provider.chat(ask()).catch((e: unknown) => e)) as Error;
    expect(err.message).toBe('My AI at https://ai.example/v1 answered with an error (400): bad key [key hidden]');
    expect((await drain(provider, ask())).error?.message).not.toContain('sk-1');
    expect((await provider.health()).detail).not.toContain('sk-1');
  });
});
