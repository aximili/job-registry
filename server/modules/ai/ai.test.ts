import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../shared/contracts/index.ts';
import { FakeAiProvider, defaultReply } from '../../../tests/fakes/fake-ai-provider.ts';
import { AiUnavailableError } from '../../core/errors.ts';
import { FakeRuntime } from '../../../tests/fakes/fake-runtime.ts';
import { fileURLToPath } from 'node:url';
import { createTestApp, freePort, type TestApp } from '../../../tests/helpers/test-app.ts';

const fakeLlama = fileURLToPath(new URL('../../../tests/fakes/fake-llama-server.ts', import.meta.url));
const answers = (port: number) =>
  fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
    .then((r) => r.ok)
    .catch(() => false);
async function eventually(check: () => Promise<boolean>, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

let app: TestApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

describe('AI service', () => {
  it('GET /ai/status starts "off", and a task moves it through busy to ready, sending ai.stateChanged', async () => {
    app = await createTestApp();
    const states: string[] = [];
    app.bus.on('ai.stateChanged', ({ state }) => states.push(state));
    const before = await app.request('GET', '/api/v1/ai/status');
    expect(before.body).toEqual({ state: 'off', detail: null, preset: 'llama-server', baseUrl: 'http://127.0.0.1:8080/v1' });
    await app.services.ai.parseJob('An ad.');
    expect(states).toEqual(['starting', 'ready', 'busy', 'ready']);
    expect((await app.request('GET', '/api/v1/ai/status')).body.state).toBe('ready');
  });

  it("a runtime that can't start sets the state to error, with the reason", async () => {
    const runtime = new FakeRuntime();
    runtime.failWith = "The AI program isn't installed: ai/llama.cpp/llama-server.exe is missing.";
    app = await createTestApp({ fakes: { runtime } });
    await expect(app.services.ai.parseJob('An ad.')).rejects.toThrow("The AI program isn't installed");
    expect(app.services.ai.status()).toMatchObject({ state: 'error', detail: runtime.failWith });
  });

  it('a server that stops answering mid-task shows as an error until the next task works', async () => {
    let fail = true;
    const provider = new FakeAiProvider((req) =>
      fail ? new AiUnavailableError("The AI at x didn't answer within 300 seconds.") : defaultReply(req),
    );
    app = await createTestApp({ fakes: { ai: provider } });
    await expect(app.services.ai.parseJob('An ad.')).rejects.toThrow("didn't answer");
    expect(app.services.ai.status()).toMatchObject({ state: 'error', detail: "The AI at x didn't answer within 300 seconds." });
    fail = false;
    await app.services.ai.parseJob('An ad.');
    expect(app.services.ai.status()).toMatchObject({ state: 'ready', detail: null });
  });

  it('a badly formed answer is not a server problem: the state stays ready', async () => {
    app = await createTestApp({ fakes: { ai: new FakeAiProvider(() => 'not json') } });
    await expect(app.services.ai.parseJob('An ad.')).rejects.toThrow("didn't fit the expected format");
    expect(app.services.ai.status().state).toBe('ready');
  });

  it('POST /ai/test reports the reply time', async () => {
    app = await createTestApp();
    const res = await app.request('POST', '/api/v1/ai/test', {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, models: ['fake-model'] });
    expect(res.body.detail).toMatch(/^Connected to Bonsai 2 \(llama-server, started by the app\)\. It replied in \d+ ms\.$/);
    expect(typeof res.body.replyMs).toBe('number');
  });

  it("POST /ai/test sends what reading an ad would send: the task's model, thinking and extra fields", async () => {
    const provider = new FakeAiProvider();
    app = await createTestApp({
      fakes: { ai: provider },
      settings: { ai: { tasks: { parse: { model: 'small', thinking: false, extra: { reasoning_effort: null, top_k: 20 } } } } } as never,
    });
    expect((await app.request('POST', '/api/v1/ai/test', {})).body.ok).toBe(true);
    expect(provider.calls[0]).toMatchObject({ model: 'small', thinking: false, extra: { reasoning_effort: null, top_k: 20 } });
    // A server that refuses JSON-schema answers fails the test, not every ad later.
    expect(provider.calls[0]!.jsonSchema?.name).toBe('connection_test');
  });

  it('POST /ai/test asks for a model when the server needs one', async () => {
    app = await createTestApp({ settings: { ai: { preset: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' } } as never });
    const res = await app.request('POST', '/api/v1/ai/test', {});
    expect(res.body).toEqual({ ok: false, detail: 'Pick a model. The server has: fake-model.', models: ['fake-model'], replyMs: null });
  });

  it('a Test connection that asks for a model leaves the pill on "AI problem", not "AI ready"', async () => {
    app = await createTestApp({ settings: { ai: { preset: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' } } as never });
    const states: string[] = [];
    app.bus.on('ai.stateChanged', ({ state }) => states.push(state));
    await app.request('POST', '/api/v1/ai/test', {});
    expect(app.services.ai.status()).toMatchObject({ state: 'error', detail: 'Pick a model. The server has: fake-model.' });
    // The runtime may report "ready" as it starts, but no task finished well:
    // "busy" is never followed by "ready".
    expect(states.join(',')).not.toContain('busy,ready');
    expect(states.at(-1)).toBe('error');
  });

  it('POST /ai/test never throws: a failure is a result', async () => {
    const runtime = new FakeRuntime();
    runtime.failWith = "Can't reach the AI at http://127.0.0.1:8080/v1. Check that it's running, or pick another AI in Settings.";
    app = await createTestApp({ fakes: { runtime } });
    const res = await app.request('POST', '/api/v1/ai/test', {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, detail: runtime.failWith, models: [], replyMs: null });
  });

  it('stopNow ends the AI program at once, for a crash', async () => {
    const runtime = new FakeRuntime();
    app = await createTestApp({ fakes: { runtime } });
    await app.services.ai.parseJob('An ad.');
    app.stopChildrenNow();
    expect(runtime.stops).toBe(1);
    expect(runtime.state()).toBe('off');
  });

  it('closing the app stops the AI runtime', async () => {
    const runtime = new FakeRuntime();
    app = await createTestApp({ fakes: { runtime } });
    await app.services.ai.parseJob('An ad.');
    await app.cleanup();
    app = undefined;
    expect(runtime.stops).toBeGreaterThanOrEqual(1);
  });

  it('live events forward ai.stateChanged to the dashboard', async () => {
    const port = await freePort();
    app = await createTestApp({ port });
    await app.http.listen({ host: '127.0.0.1', port });
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/events`, { headers: { host: `127.0.0.1:${port}` }, signal: controller.signal });
    const reader = res.body!.getReader();
    await app.services.ai.parseJob('An ad.');
    let text = '';
    while (!text.includes('event: ai.stateChanged')) text += new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    expect(text).toContain('event: ai.stateChanged');
  });

  it('with the default settings and no llama-server installed, it says how to install it', async () => {
    // The default program, on a port nothing else uses: on the Windows PC,
    // Bonsai 2 may already be answering on the default port 8080.
    const port = await freePort();
    const ai = DEFAULT_SETTINGS.ai;
    const args = ai.managed.args.map((a, i, all) => (all[i - 1] === '--port' ? String(port) : a));
    app = await createTestApp({
      realRuntime: true,
      settings: { ai: { ...ai, baseUrl: `http://127.0.0.1:${port}/v1`, managed: { ...ai.managed, args } } },
    });
    await expect(app.services.ai.parseJob('An ad.')).rejects.toThrow(
      "The AI program isn't installed: ai/llama.cpp/llama-server.exe is missing. Run download-ai.bat, or pick another AI in Settings.",
    );
  });

  it('switching from Bonsai to Ollama in settings stops the llama-server the app started', async () => {
    const port = await freePort();
    app = await createTestApp({
      realRuntime: true,
      settings: { ai: { baseUrl: `http://127.0.0.1:${port}/v1`, managed: { exe: process.execPath, args: [fakeLlama, '--port', String(port)] } } } as never,
    });
    await app.services.ai.parseJob('An ad.');
    expect(await answers(port)).toBe(true);
    const ai = app.services.settings.get().ai;
    app.services.settings.update({ ai: { ...ai, preset: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' } });
    expect(await eventually(async () => !(await answers(port)))).toBe(true);
    await app.services.ai.parseJob('An ad.');
    expect(app.services.ai.status()).toMatchObject({ state: 'ready', preset: 'ollama' });
  });
});

