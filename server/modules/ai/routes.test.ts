// The AI routes for testing any AI and listing its models, and app.ts's
// wiring: each AI gets its own connector and its own key.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeAi, DEFAULT_SETTINGS, newSavedAi, type SavedAi } from '../../../shared/contracts/index.ts';
import { FAKE_PARSED } from '../../../tests/fakes/fake-ai-provider.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

const bonsai = activeAi(DEFAULT_SETTINGS.ai);
const claude: SavedAi = newSavedAi('anthropic', 'Claude – mine', ['bonsai-2']);
const openai: SavedAi = newSavedAi('openai', 'OpenAI', ['bonsai-2', 'claude-mine']);
const secretsFile = (a: TestApp) => join(a.root, 'config', 'secrets.json');

// A stand-in for the cloud: every request is kept, and reply() answers it.
function fakeCloud(reply: (url: string) => Response) {
  const sent: { url: string; headers: Record<string, string> }[] = [];
  const doFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    sent.push({ url: String(input), headers: Object.fromEntries(new Headers(init.headers).entries()) });
    return reply(String(input));
  }) as typeof fetch;
  return { fetch: doFetch, sent };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('AI routes: test any AI, and list its models', () => {
  it('GET /ai/status names the AI in use', async () => {
    app = await createTestApp({ settings: { ai: { active: 'claude-mine', saved: [bonsai, claude] } } });
    expect((await app.request('GET', '/api/v1/ai/status')).body).toMatchObject({
      id: 'claude-mine',
      name: 'Claude – mine',
      preset: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
    });
  });

  it('/ai/check and /ai/models are for the dashboard only', async () => {
    app = await createTestApp();
    for (const url of ['/api/v1/ai/check', '/api/v1/ai/models']) {
      for (const origin of ['moz-extension://abc-123', 'chrome-extension://abc-123']) {
        const res = await app.request('POST', url, { ai: bonsai }, { origin });
        expect(res.status, `${url} from ${origin}`).toBe(403);
      }
      expect((await app.request('POST', url, { ai: bonsai })).status).toBe(200);
    }
  });

  it('a check of an AI you have not saved never saves it, or its key', async () => {
    app = await createTestApp();
    const settings = readFileSync(join(app.root, 'config', 'settings.json'), 'utf8');
    const res = await app.request('POST', '/api/v1/ai/check', { ai: openai, key: 'sk-typed-1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(readFileSync(join(app.root, 'config', 'settings.json'), 'utf8')).toBe(settings);
    expect(app.services.settings.secrets().aiKeys).toEqual([]);
    expect(app.services.ai.status().id).toBe('bonsai-2');
  });
});

describe('app wiring: each AI gets its own connector and its own key', () => {
  it("a Claude AI goes through Claude's own connector, and an OpenAI-style one through the other", async () => {
    const cloud = fakeCloud((url) => json(200, { data: [{ id: url.includes('anthropic') ? 'claude-sonnet-5-5' : 'gpt-5.5' }] }));
    app = await createTestApp({
      realProvider: true,
      fetch: cloud.fetch,
      settings: { ai: { active: 'claude-mine', saved: [bonsai, claude, openai] } },
      secrets: { aiKeys: { 'claude-mine': 'sk-ant-saved-1', openai: 'sk-oai-saved-2' } },
    });
    expect((await app.request('POST', '/api/v1/ai/models', { ai: claude })).body).toEqual({ ok: true, models: ['claude-sonnet-5-5'], detail: null });
    expect((await app.request('POST', '/api/v1/ai/models', { ai: openai })).body).toEqual({ ok: true, models: ['gpt-5.5'], detail: null });
    const [toClaude, toOpenAi] = cloud.sent;
    expect(toClaude!.url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(toClaude!.headers).toMatchObject({ 'x-api-key': 'sk-ant-saved-1', 'anthropic-version': '2023-06-01' });
    expect(toClaude!.headers.authorization).toBeUndefined();
    expect(toOpenAi!.url).toBe('https://api.openai.com/v1/models');
    expect(toOpenAi!.headers).toMatchObject({ authorization: 'Bearer sk-oai-saved-2' });
    expect(toOpenAi!.headers['x-api-key']).toBeUndefined();
  });

  it("an anthropic AI at an address you typed still goes through Claude's connector", async () => {
    const cloud = fakeCloud(() => json(200, { data: [{ id: 'claude-sonnet-5-5' }] }));
    app = await createTestApp({ realProvider: true, fetch: cloud.fetch });
    const res = await app.request('POST', '/api/v1/ai/models', { ai: { ...claude, baseUrl: 'https://claude.example.com/v1' }, key: 'sk-ant-typed' });
    expect(res.body).toMatchObject({ ok: true });
    expect(cloud.sent[0]!.url).toBe('https://claude.example.com/v1/models?limit=1000');
    expect(cloud.sent[0]!.headers['x-api-key']).toBe('sk-ant-typed');
  });

  it('a cloud AI has no program to check: a task goes straight to its chat, with no model list first', async () => {
    const cloud = fakeCloud(() => json(200, { choices: [{ message: { content: JSON.stringify(FAKE_PARSED) }, finish_reason: 'stop' }] }));
    app = await createTestApp({
      realProvider: true,
      realRuntime: true,
      fetch: cloud.fetch,
      settings: { ai: { active: 'openai', saved: [bonsai, openai] } },
      secrets: { aiKeys: { openai: 'sk-oai-saved' } },
    });
    await expect(app.services.ai.parseJob('An ad.')).resolves.toMatchObject({ title: 'Senior Engineer' });
    expect(cloud.sent.map((s) => s.url)).toEqual(['https://api.openai.com/v1/chat/completions']);
    expect(app.services.ai.status()).toMatchObject({ state: 'ready', id: 'openai' });
  });

  it("keeps the AI in use's provider, but not one made for a form's test, and drops it when the AIs change", async () => {
    // Claude with No limit asks its model list once per provider, for the model's own limit.
    const cloud = fakeCloud((url) =>
      url.includes('/models')
        ? json(200, { data: [{ id: 'claude-sonnet-5-5', max_tokens: 64000 }] })
        : json(200, { content: [{ type: 'text', text: JSON.stringify(FAKE_PARSED) }], stop_reason: 'end_turn' }),
    );
    const noLimit: SavedAi = { ...claude, tasks: { ...claude.tasks, parse: { ...claude.tasks.parse, thinking: true, thinkingEffort: 'max' } } };
    app = await createTestApp({
      realProvider: true,
      fetch: cloud.fetch,
      settings: { ai: { active: 'claude-mine', saved: [bonsai, noLimit] } },
      secrets: { aiKeys: { 'claude-mine': 'sk-ant-saved' } },
    });
    const lookups = (key: string) => cloud.sent.filter((s) => s.url.includes('/models') && s.headers['x-api-key'] === key).length;
    await app.services.ai.parseJob('An ad.');
    await app.services.ai.parseJob('An ad.');
    expect(lookups('sk-ant-saved')).toBe(1);
    // A form's test with a typed key gets a provider of its own, which isn't kept.
    expect((await app.request('POST', '/api/v1/ai/check', { ai: noLimit, key: 'sk-ant-typed' })).body.ok).toBe(true);
    expect(lookups('sk-ant-typed')).toBe(1);
    await app.services.ai.parseJob('An ad.');
    expect(lookups('sk-ant-saved')).toBe(1);
    // A change to the AIs drops the one kept.
    app.services.settings.useAi('bonsai-2');
    app.services.settings.useAi('claude-mine');
    await app.services.ai.parseJob('An ad.');
    expect(lookups('sk-ant-saved')).toBe(2);
  });

  it('a key in the request never comes back, even when the provider repeats it', async () => {
    const typed = 'sk-typed-secret-1234567890';
    const cloud = fakeCloud(() => json(400, { error: { message: `Unknown model for ${typed}` } }));
    app = await createTestApp({ realProvider: true, fetch: cloud.fetch });
    for (const url of ['/api/v1/ai/check', '/api/v1/ai/models']) {
      const res = await app.request('POST', url, { ai: openai, key: typed });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain(typed);
    }
    // It went to its own provider, and nowhere else.
    expect(cloud.sent.length).toBeGreaterThan(0);
    for (const sent of cloud.sent) {
      expect(sent.url.startsWith('https://api.openai.com/v1/')).toBe(true);
      expect(sent.headers.authorization).toBe(`Bearer ${typed}`);
    }
    // A refused request never repeats it either, even under a name it doesn't know.
    const refused = await app.request('POST', '/api/v1/ai/check', { ai: openai, key: typed, [typed]: 1 });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).not.toContain(typed);
  });

  it('a refused key shows in the pill until you save a new one, which clears it at once', async () => {
    const REFUSED = 'OpenAI refused its API key. Check the key in Settings → AI.';
    const cloud = fakeCloud(() => json(401, { error: { message: 'Incorrect API key provided.' } }));
    app = await createTestApp({
      realProvider: true,
      realRuntime: true,
      fetch: cloud.fetch,
      settings: { ai: { active: 'openai', saved: [bonsai, openai] } },
      secrets: { aiKeys: { openai: 'sk-oai-old' } },
    });
    await expect(app.services.ai.parseJob('An ad.')).rejects.toThrow(REFUSED);
    expect((await app.request('GET', '/api/v1/ai/status')).body).toMatchObject({ state: 'error', detail: REFUSED });
    const told: unknown[] = [];
    app.bus.on('ai.stateChanged', (e) => told.push(e));
    expect((await app.request('PUT', '/api/v1/settings/secrets', { aiKeys: { openai: 'sk-oai-new' } })).status).toBe(200);
    expect((await app.request('GET', '/api/v1/ai/status')).body).toMatchObject({ state: 'ready', detail: null });
    expect(told).toEqual([{ state: 'ready', detail: null, id: 'openai', name: 'OpenAI' }]);
  });

  it("saving the AI in use's settings clears its problem too", async () => {
    const REFUSED = 'OpenAI refused its API key. Check the key in Settings → AI.';
    const cloud = fakeCloud(() => json(401, { error: { message: 'Incorrect API key provided.' } }));
    app = await createTestApp({
      realProvider: true,
      realRuntime: true,
      fetch: cloud.fetch,
      settings: { ai: { active: 'openai', saved: [bonsai, openai] } },
      secrets: { aiKeys: { openai: 'sk-oai-old' } },
    });
    await expect(app.services.ai.parseJob('An ad.')).rejects.toThrow(REFUSED);
    const edited = { ...openai, model: 'gpt-5.5-mini' };
    expect((await app.request('PATCH', '/api/v1/settings', { ai: { active: 'openai', saved: [bonsai, edited] } })).status).toBe(200);
    await vi.waitFor(async () => expect((await app!.request('GET', '/api/v1/ai/status')).body).toMatchObject({ state: 'ready', detail: null }));
  });

  it("a broken secrets.json doesn't stop an AI that takes no key", async () => {
    // Bonsai 2 on this computer, through the real connector.
    const local = fakeCloud((url) =>
      url.endsWith('/models')
        ? json(200, { data: [{ id: 'fake-model' }] })
        : json(200, { choices: [{ message: { content: JSON.stringify(FAKE_PARSED) }, finish_reason: 'stop' }] }),
    );
    app = await createTestApp({ realProvider: true, fetch: local.fetch });
    writeFileSync(secretsFile(app), '{ "aiKeys": { "bonsai-2": 42 } }');
    await expect(app.services.ai.parseJob('An ad.')).resolves.toMatchObject({ title: 'Senior Engineer' });
    expect((await app.request('POST', '/api/v1/ai/test', {})).body.ok).toBe(true);
    expect(local.sent.map((s) => s.url)).toContain('http://127.0.0.1:8080/v1/chat/completions');
    expect(local.sent.every((s) => s.headers.authorization === undefined)).toBe(true);
  });

  it("nor Ollama, which the app checks before each task but never starts", async () => {
    const local = fakeCloud((url) =>
      url.endsWith('/models')
        ? json(200, { data: [{ id: 'qwen3:8b' }] })
        : json(200, { choices: [{ message: { content: JSON.stringify(FAKE_PARSED) }, finish_reason: 'stop' }] }),
    );
    const ollama = newSavedAi('ollama', 'Ollama', ['bonsai-2']);
    app = await createTestApp({ realProvider: true, realRuntime: true, fetch: local.fetch, settings: { ai: { active: 'ollama', saved: [bonsai, ollama] } } });
    writeFileSync(secretsFile(app), '{ "aiKeys": { "ollama": 42 } }');
    await expect(app.services.ai.parseJob('An ad.')).resolves.toMatchObject({ title: 'Senior Engineer' });
    expect(local.sent.map((s) => s.url)).toEqual(['http://127.0.0.1:11434/v1/models', 'http://127.0.0.1:11434/v1/chat/completions']);
  });

  it('for an AI that takes a key, a broken secrets.json says where the mistake is, never the key', async () => {
    app = await createTestApp({ settings: { ai: { active: 'openai', saved: [bonsai, openai] } } });
    writeFileSync(secretsFile(app), JSON.stringify({ aiKeys: { openai: 'sk-live-abc123' }, extra: 'x' }));
    const err = (await app.services.ai.parseJob('An ad.').catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("has a problem in a name it doesn't know");
    expect(err.message).not.toContain('sk-live-abc123');
  });
});
