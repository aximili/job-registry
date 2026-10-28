import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeOpenAiServer, type FakeHandler, type FakeOpenAiServer } from '../../../../tests/fakes/fake-openai-server.ts';
import { AiRefusedError, AiUnavailableError } from '../../../core/errors.ts';
import type { ChatRequest } from '../provider.ts';
import { createOpenAiCompatibleProvider } from './openai-compatible.ts';

let server: FakeOpenAiServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function setup(handler?: FakeHandler, config: { model?: string; timeoutSec?: number } = {}) {
  server = await startFakeOpenAiServer(handler);
  const provider = createOpenAiCompatibleProvider(() => ({
    baseUrl: server!.url,
    model: config.model ?? 'qwen3:8b',
    timeoutSec: config.timeoutSec ?? 10,
  }));
  return { provider, server };
}

const ask = (extra: Partial<ChatRequest> = {}): ChatRequest => ({
  messages: [
    { role: 'system', content: 'You read job ads.' },
    { role: 'user', content: 'The ad.' },
  ],
  ...extra,
});

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
    await provider.chat(ask({ thinking: true, thinkingEffort: 'xhigh' }));
    await provider.chat(ask());
    expect(server.requests.map((r) => r.reasoning_effort)).toEqual(['none', 'medium', 'xhigh', undefined]);
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

  it('a wrong address (no /v1) names the address in the error', async () => {
    server = await startFakeOpenAiServer();
    const provider = createOpenAiCompatibleProvider(() => ({ baseUrl: server!.origin, model: 'm', timeoutSec: 5 }));
    const health = await provider.health();
    expect(health).toEqual({ ok: false, models: [], detail: `The AI at ${server.origin} answered with an error (404): Not found` });
  });

  it("health lists the server's models", async () => {
    const { provider } = await setup();
    expect(await provider.health()).toEqual({ ok: true, models: ['fake-model'], detail: null });
  });

  it('a server that is not running gives a plain "Can\'t reach the AI at …" error', async () => {
    const port = await closedPort();
    const provider = createOpenAiCompatibleProvider(() => ({ baseUrl: `http://127.0.0.1:${port}/v1`, model: '', timeoutSec: 5 }));
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err).not.toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(
      `Can't reach the AI at http://127.0.0.1:${port}/v1. Check that it's running, or pick another AI in Settings.`,
    );
    const health = await provider.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain("Can't reach the AI");
  });

  it('a slow server times out with the address and the time limit', async () => {
    const { provider, server } = await setup(() => ({ content: 'late', delayMs: 1500 }), { timeoutSec: 1 });
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(`The AI at ${server.url} didn't answer within 1 seconds.`);
  });

  it("an HTTP 500 shows the server's own message", async () => {
    const { provider, server } = await setup(() => ({ status: 500, error: 'reasoning_effort "high" is not supported' }));
    const err = await provider.chat(ask()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe(`The AI at ${server.url} answered with an error (500): reasoning_effort "high" is not supported`);
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
