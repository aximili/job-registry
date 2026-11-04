// Several saved AIs: each task goes to the AI in use, a switch starts the new
// one at once, any AI can be tested, and the app checks that the right local
// model answers. These build the AI service on its own, with a settings
// object the tests change, so a switch is a plain settings.changed event.

import { spawn as realSpawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeAi, AI_PRESETS, DEFAULT_SETTINGS, type AiSettings, type SavedAi } from '../../../shared/contracts/index.ts';
import { defaultReply, FakeAiProvider } from '../../../tests/fakes/fake-ai-provider.ts';
import { FakeRuntime } from '../../../tests/fakes/fake-runtime.ts';
import { freePort } from '../../../tests/helpers/test-app.ts';
import { AiAccountError, AiUnavailableError } from '../../core/errors.ts';
import { createEventBus } from '../../core/events.ts';
import type { Logger } from '../../core/logger.ts';
import type { ChatRequest } from './provider.ts';
import type { ModelRuntime } from './runtime.ts';
import { createCloudRuntime } from './runtime/cloud.ts';
import { createLlamaServerRuntime } from './runtime/llama-server.ts';
import { createAiService, type AiService, type WriteInput } from './service.ts';

const silent = pino({ level: 'silent' }) as Logger;
const bonsai = activeAi(DEFAULT_SETTINGS.ai);
const saved = (ai: Partial<SavedAi> & Pick<SavedAi, 'id' | 'name'>): SavedAi => ({ ...bonsai, ...ai });
const claude = saved({ id: 'claude-mine', name: 'Claude – mine', preset: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' });
const openai = saved({ id: 'openai', name: 'OpenAI', preset: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.5' });
const ollama = saved({ id: 'ollama', name: 'Ollama', preset: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' });
// Your own start_bonsai.bat, with or without its Model file.
const bat = (id: string, name: string, model = ''): SavedAi =>
  saved({ id, name, model, managed: { ...bonsai.managed, exe: 'D:\\aitest\\Bonsai-demo\\start_bonsai.bat' } });

const task = (c: ChatRequest) => c.jsonSchema?.name ?? 'write';
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const services: AiService[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const fn of cleanups.splice(0).reverse()) fn();
});

function setup(o: {
  saved: SavedAi[];
  active: string;
  keys?: Record<string, string>;
  // One runtime for every AI, made from the AI in use. Otherwise each kind
  // gets its own, as app.ts picks them.
  runtime?: (getConfig: () => SavedAi) => ModelRuntime;
}) {
  const bus = createEventBus(silent);
  const settings: AiSettings = { active: o.active, writer: null, saved: o.saved };
  const getConfig = () => activeAi(settings);
  const providers = new Map<string, FakeAiProvider>();
  const provider = (id: string): FakeAiProvider => {
    if (!providers.has(id)) providers.set(id, new FakeAiProvider());
    return providers.get(id)!;
  };
  // Which AI, and which key, each provider was made for.
  const asked: { id: string; key: string | null }[] = [];
  const getKey = vi.fn((id: string): string | null => o.keys?.[id] ?? null);
  const runtimes = { managed: new FakeRuntime(), external: new FakeRuntime(), cloud: createCloudRuntime() };
  const only = o.runtime?.(getConfig);
  const runtime = (): ModelRuntime => {
    if (only) return only;
    const ai = getConfig();
    if (AI_PRESETS[ai.preset].group === 'cloud') return runtimes.cloud;
    return ai.preset === 'llama-server' && ai.managed.enabled ? runtimes.managed : runtimes.external;
  };
  const service = createAiService({
    providerFor: (ai, key) => {
      asked.push({ id: ai.id, key });
      return provider(ai.id);
    },
    getKey,
    getAll: () => settings.saved,
    runtime,
    getConfig,
    getWriter: () => ({ ai: getConfig(), inUse: true }),
    bus,
    logger: silent,
    now: () => new Date(),
  });
  services.push(service);
  const states: string[] = [];
  bus.on('ai.stateChanged', ({ state }) => states.push(state));
  // What PUT /settings/ai/active does: save, then say so.
  const use = (id: string) => {
    settings.active = id;
    bus.emit('settings.changed', { keys: ['ai'] });
  };
  return { service, use, provider, asked, getKey, runtimes, states, settings, bus };
}

describe('each task uses the AI in use', () => {
  it('with its own provider and its saved key', async () => {
    const t = setup({ saved: [bonsai, claude], active: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    await t.service.parseJob('An ad.');
    await t.service.rateJob({ profile: 'I write TypeScript.', preferences: null, ad: 'We need TypeScript.' });
    expect(t.asked).toEqual([
      { id: 'claude-mine', key: 'sk-ant-saved' },
      { id: 'claude-mine', key: 'sk-ant-saved' },
    ]);
    expect(t.getKey).toHaveBeenCalledWith('claude-mine');
    expect(t.provider('claude-mine').calls.map(task)).toEqual(['parsed_job', 'rating']);

    t.use('bonsai-2');
    await t.service.rateCard({ profile: 'I write TypeScript.', preferences: null, card: 'Senior Engineer\nAtlassian' });
    expect(t.asked.at(-1)).toEqual({ id: 'bonsai-2', key: null });
    expect(t.provider('bonsai-2').calls.map(task)).toEqual(['card_rating']);
    expect(t.provider('claude-mine').calls).toHaveLength(2);
  });

  it("an AI that takes no key never reads one, so a broken secrets.json can't stop it", async () => {
    const t = setup({ saved: [bonsai, ollama], active: 'bonsai-2' });
    t.getKey.mockImplementation(() => {
      throw new Error('config/secrets.json has a problem in "aiKeys".');
    });
    await t.service.parseJob('An ad.');
    t.use('ollama');
    await t.service.parseJob('An ad.');
    // A key typed for one is never sent either.
    expect(await t.service.check({ ai: ollama, key: 'sk-typed' })).toMatchObject({ ok: true });
    expect(await t.service.models({ ai: bonsai })).toMatchObject({ ok: true });
    expect(t.getKey).not.toHaveBeenCalled();
    expect(t.asked.length).toBeGreaterThan(0);
    expect(t.asked.every((a) => a.key === null)).toBe(true);
  });

  it('a saved key goes only to the kind of AI it was saved for', async () => {
    const t = setup({ saved: [bonsai, claude], active: 'bonsai-2', keys: { 'claude-mine': 'sk-ant-saved' } });
    // The form changed it to another provider: Claude's key isn't sent there.
    await t.service.check({ ai: { ...claude, preset: 'openai', baseUrl: 'https://api.openai.com/v1' } });
    expect(t.asked.at(-1)).toEqual({ id: 'claude-mine', key: null });
    // The same provider at an address you typed is still that AI.
    await t.service.check({ ai: { ...claude, baseUrl: 'https://claude.example.com/v1' } });
    expect(t.asked.at(-1)).toEqual({ id: 'claude-mine', key: 'sk-ant-saved' });
    // A new AI that isn't saved yet has no saved key.
    await t.service.models({ ai: { ...claude, id: 'claude-new', name: 'Claude – new' } });
    expect(t.asked.at(-1)).toEqual({ id: 'claude-new', key: null });
  });
});

describe('switching the AI in use', () => {
  it('to an AI the app starts: the old runtime stops, then the new one starts at once, before any task', async () => {
    const t = setup({ saved: [ollama, bonsai], active: 'ollama' });
    await t.service.parseJob('An ad.');
    const { managed, external } = t.runtimes;
    const order: string[] = [];
    const stopOld = external.stop.bind(external);
    external.stop = async () => {
      order.push('old stopped');
      await stopOld();
    };
    const start = managed.ensureRunning.bind(managed);
    managed.ensureRunning = async (signal, opts = {}) => {
      order.push(opts.background ? 'new started in the background' : 'new started');
      return start(signal, opts);
    };
    t.use('bonsai-2');
    await vi.waitFor(() => expect(t.service.status()).toMatchObject({ state: 'ready', id: 'bonsai-2', name: 'Bonsai 2' }));
    expect(order).toEqual(['old stopped', 'new started']);
    expect(t.provider('bonsai-2').calls).toEqual([]);
  });

  it('to a cloud AI, or a server you run yourself, starts nothing', async () => {
    const t = setup({ saved: [bonsai, claude, ollama], active: 'bonsai-2' });
    await t.service.parseJob('An ad.');
    const cloudStart = vi.spyOn(t.runtimes.cloud, 'ensureRunning');
    t.use('claude-mine');
    await vi.waitFor(() => expect(t.runtimes.managed.stops).toBe(1));
    expect(t.service.status()).toMatchObject({ state: 'ready', id: 'claude-mine', name: 'Claude – mine', preset: 'anthropic' });
    t.use('ollama');
    await tick();
    // Only the task's start, before the switches.
    expect(t.runtimes.managed.background).toEqual([false]);
    expect(t.runtimes.external.background).toEqual([]);
    expect(cloudStart).not.toHaveBeenCalled();
    expect(t.provider('claude-mine').calls).toEqual([]);
    expect(t.provider('ollama').calls).toEqual([]);
  });

  it("clears the old AI's problem: the pill is about the AI in use", async () => {
    const t = setup({ saved: [claude, openai], active: 'claude-mine' });
    t.provider('claude-mine').reply = () => new AiAccountError('Claude – mine refused its API key. Check the key in Settings → AI.');
    await expect(t.service.parseJob('An ad.')).rejects.toThrow('refused its API key');
    expect(t.service.status()).toMatchObject({ state: 'error', id: 'claude-mine' });
    t.use('openai');
    await vi.waitFor(() => expect(t.service.status()).toMatchObject({ state: 'ready', detail: null, id: 'openai', name: 'OpenAI' }));
  });

  it("a task waiting for the old AI's program to start runs on the new AI instead", async () => {
    const t = setup({ saved: [bonsai, claude], active: 'bonsai-2' });
    t.runtimes.managed.slowStart = true;
    const reading = t.service.parseJob('An ad.');
    await vi.waitFor(() => expect(t.runtimes.managed.state()).toBe('starting'));
    t.use('claude-mine');
    await expect(reading).resolves.toMatchObject({ title: 'Senior Engineer' });
    expect(t.provider('claude-mine').finished.map(task)).toEqual(['parsed_job']);
    expect(t.provider('bonsai-2').calls).toEqual([]);
  });

  it("a task you cancel while it waits for the program still stops, switch or not", async () => {
    const t = setup({ saved: [bonsai, claude], active: 'bonsai-2' });
    t.runtimes.managed.slowStart = true;
    const controller = new AbortController();
    const reading = t.service.parseJob('An ad.', { signal: controller.signal });
    await vi.waitFor(() => expect(t.runtimes.managed.state()).toBe('starting'));
    controller.abort();
    t.use('claude-mine');
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    await t.service.onIdle();
    expect(t.provider('claude-mine').calls).toEqual([]);
  });

  it('every switch tells the dashboard which AI is in use, even when the state stays the same', async () => {
    const t = setup({ saved: [claude, openai], active: 'claude-mine' });
    const events: unknown[] = [];
    t.bus.on('ai.stateChanged', (e) => events.push(e));
    expect(t.service.status().state).toBe('ready');
    t.use('openai');
    await vi.waitFor(() => expect(events).toEqual([{ state: 'ready', detail: null, id: 'openai', name: 'OpenAI' }]));
    t.use('claude-mine');
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events[1]).toEqual({ state: 'ready', detail: null, id: 'claude-mine', name: 'Claude – mine' });
  });

  it('renaming the AI in use tells the dashboard its new name', async () => {
    const t = setup({ saved: [claude], active: 'claude-mine' });
    await t.service.parseJob('An ad.');
    const events: unknown[] = [];
    t.bus.on('ai.stateChanged', (e) => events.push(e));
    t.settings.saved = [{ ...claude, name: 'Claude – work' }];
    t.use('claude-mine');
    await vi.waitFor(() => expect(events).toEqual([{ state: 'ready', detail: null, id: 'claude-mine', name: 'Claude – work' }]));
  });

  it('an edit to the AI in use is not a switch: nothing starts', async () => {
    const t = setup({ saved: [bonsai], active: 'bonsai-2' });
    t.settings.saved = [{ ...bonsai, timeoutSec: 60 }];
    t.use('bonsai-2');
    await tick();
    expect(t.runtimes.managed.background).toEqual([]);
  });
});

describe("the AI in use's problem clears when you fix it", () => {
  const REFUSED = 'Claude – mine refused its API key. Check the key in Settings → AI.';

  // Claude in use, with a key Claude refuses: the pill shows the problem.
  async function refused(keys: Record<string, string> = { 'claude-mine': 'sk-ant-old' }) {
    const t = setup({ saved: [claude, openai], active: 'claude-mine', keys });
    t.provider('claude-mine').reply = () => new AiAccountError(REFUSED);
    await expect(t.service.parseJob('An ad.')).rejects.toThrow(REFUSED);
    expect(t.service.status()).toMatchObject({ state: 'error', detail: REFUSED });
    const events: unknown[] = [];
    t.bus.on('ai.stateChanged', (e) => events.push(e));
    return { ...t, keys, events };
  }

  it('saving a new key for it clears the problem, and tells the dashboard', async () => {
    const t = await refused();
    t.keys['claude-mine'] = 'sk-ant-new';
    t.bus.emit('settings.changed', { keys: ['aiKeys'] });
    expect(t.service.status()).toMatchObject({ state: 'ready', detail: null });
    expect(t.events).toEqual([{ state: 'ready', detail: null, id: 'claude-mine', name: 'Claude – mine' }]);
  });

  it('adding the key it needed clears "needs an API key" too', async () => {
    const t = setup({ saved: [claude], active: 'claude-mine', keys: {} });
    const needsKey = 'Claude – mine needs an API key. Add it in Settings → AI.';
    t.provider('claude-mine').reply = () => new AiAccountError(needsKey);
    await expect(t.service.parseJob('An ad.')).rejects.toThrow(needsKey);
    expect(t.service.status()).toMatchObject({ state: 'error', detail: needsKey });
    (t.getKey as unknown as { mockImplementation: (fn: () => string) => void }).mockImplementation(() => 'sk-ant-new');
    t.bus.emit('settings.changed', { keys: ['aiKeys'] });
    expect(t.service.status()).toMatchObject({ state: 'ready', detail: null });
  });

  it("a new key for another AI leaves the AI in use's problem as it is", async () => {
    const t = await refused();
    t.keys.openai = 'sk-oai-new';
    t.bus.emit('settings.changed', { keys: ['aiKeys'] });
    expect(t.service.status()).toMatchObject({ state: 'error', detail: REFUSED });
    expect(t.events).toEqual([]);
  });

  it('an edit to the AI in use clears its problem: the next task says if it is still there', async () => {
    const t = await refused();
    t.settings.saved = [{ ...claude, model: 'claude-opus-5-5' }, openai];
    t.use('claude-mine');
    await vi.waitFor(() => expect(t.service.status()).toMatchObject({ state: 'ready', detail: null }));
    await expect(t.service.parseJob('An ad.')).rejects.toThrow(REFUSED);
    expect(t.service.status()).toMatchObject({ state: 'error', detail: REFUSED });
  });

  it('a save that leaves the AI in use as it was (adding another AI, say) keeps its problem', async () => {
    const t = await refused();
    t.settings.saved = [claude, openai, ollama];
    t.use('claude-mine');
    await tick();
    expect(t.service.status()).toMatchObject({ state: 'error', detail: REFUSED });
  });
});

describe('a cloud AI', () => {
  it('has no program to check: ready after a good task, a problem after a failed one, and no model list needed', async () => {
    const t = setup({ saved: [claude], active: 'claude-mine' });
    const provider = t.provider('claude-mine');
    const health = vi.spyOn(provider, 'health');
    await t.service.parseJob('An ad.');
    expect(t.service.status()).toMatchObject({ state: 'ready', detail: null });
    const limit = "Claude – mine says you've reached a usage limit. Wait a while, or switch to another AI from the AI pill at the top.";
    provider.reply = () => new AiAccountError(limit);
    await expect(t.service.parseJob('An ad.')).rejects.toThrow(limit);
    expect(t.service.status()).toMatchObject({ state: 'error', detail: limit });
    provider.reply = defaultReply;
    await t.service.parseJob('An ad.');
    expect(t.service.status()).toMatchObject({ state: 'ready', detail: null });
    expect(health).not.toHaveBeenCalled();
  });
});

describe('the model-file check: two local AIs on one address', () => {
  // The 27B program the app starts (its -m file), and a .bat for the 2B with its Model file.
  const big = saved({ id: 'bonsai-27b', name: 'Bonsai 27B' });
  const small = bat('bonsai-2b', 'Bonsai 2B', 'D:\\m\\Bonsai-2B.gguf');
  const BIG_FILE = 'ai/models/Ternary-Bonsai-2-27B-PQ2_0.gguf';
  const STILL_RUNNING = 'Bonsai 27B is still running on 127.0.0.1:8080. Close its window, then try again.';

  it("another saved AI's model answering: the task stops with a sentence that names it, and the pill shows it", async () => {
    const t = setup({ saved: [big, small], active: 'bonsai-2b' });
    t.provider('bonsai-2b').models = [BIG_FILE];
    const err = await t.service.parseJob('An ad.').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect((err as Error).message).toBe(STILL_RUNNING);
    expect(t.service.status()).toMatchObject({ state: 'error', detail: STILL_RUNNING });
    expect(t.provider('bonsai-2b').calls).toEqual([]);
  });

  it("a key saved for another AI never clears the wrong-model problem found at a switch", async () => {
    const keys: Record<string, string> = { 'claude-mine': 'sk-ant-old' };
    const t = setup({ saved: [claude, big, small], active: 'claude-mine', keys });
    t.provider('claude-mine').reply = () => new AiAccountError('Claude – mine refused its API key. Check the key in Settings → AI.');
    await expect(t.service.parseJob('An ad.')).rejects.toThrow('refused its API key');
    t.provider('bonsai-2b').models = [BIG_FILE];
    t.use('bonsai-2b');
    await vi.waitFor(() => expect(t.service.status()).toMatchObject({ state: 'error', detail: STILL_RUNNING }));
    keys['claude-mine'] = 'sk-ant-new';
    t.bus.emit('settings.changed', { keys: ['aiKeys'] });
    expect(t.service.status()).toMatchObject({ state: 'error', detail: STILL_RUNNING });
  });

  it('a model no saved AI uses: the sentence names the file', async () => {
    const t = setup({ saved: [big, small], active: 'bonsai-2b' });
    t.provider('bonsai-2b').models = ['C:\\models\\Mystery-7B.gguf'];
    await expect(t.service.parseJob('An ad.')).rejects.toThrow(
      "Another model (Mystery-7B.gguf) is running on 127.0.0.1:8080, not Bonsai 2B's (bonsai-2b.gguf). Close it, then try again.",
    );
  });

  it('the right file, no file to expect, or a list with no model file in it: the task runs', async () => {
    const cases: [SavedAi, string[]][] = [
      [small, ['D:\\models\\BONSAI-2B.gguf']],
      [small, []],
      // An --alias, or a fake: there's no file to compare.
      [small, ['bonsai']],
      [bat('bonsai-2b', 'Bonsai 2B'), [BIG_FILE]],
    ];
    for (const [ai, models] of cases) {
      const t = setup({ saved: [big, ai], active: 'bonsai-2b' });
      t.provider('bonsai-2b').models = models;
      await expect(t.service.parseJob('An ad.'), JSON.stringify(models)).resolves.toBeDefined();
    }
  });

  it('a model name left over from another kind of AI is not a model file: the task runs', async () => {
    const t = setup({ saved: [big, bat('bonsai-2', 'Bonsai 2', 'bonsai')], active: 'bonsai-2' });
    t.provider('bonsai-2').models = [BIG_FILE];
    await expect(t.service.parseJob('An ad.')).resolves.toBeDefined();
    expect(t.service.modelIdentity('rate')).toBe('llama-server|ai:bonsai-2');
  });

  it('switching to an AI whose model is not the one answering shows the problem at once', async () => {
    const t = setup({ saved: [big, small], active: 'bonsai-27b' });
    t.provider('bonsai-2b').models = [BIG_FILE];
    t.use('bonsai-2b');
    await vi.waitFor(() => expect(t.service.status()).toMatchObject({ state: 'error', detail: STILL_RUNNING, id: 'bonsai-2b' }));
    expect(t.provider('bonsai-2b').calls).toEqual([]);
  });

  it('Test connection checks it too, for an AI that is not in use', async () => {
    const t = setup({ saved: [big, small, claude], active: 'claude-mine' });
    t.provider('bonsai-2b').models = [BIG_FILE];
    expect(await t.service.check({ ai: small })).toEqual({ ok: false, detail: STILL_RUNNING, models: [BIG_FILE], replyMs: null });
    expect(t.service.status().state).not.toBe('error');
  });
});

describe('Test connection for any AI, and its model list', () => {
  it('an AI not in use: its own provider and the key you typed, at once, and never its program', async () => {
    const t = setup({ saved: [bonsai, claude], active: 'bonsai-2', keys: { 'claude-mine': 'sk-ant-saved' } });
    t.provider('bonsai-2').delayMs = 300;
    const reading = t.service.parseJob('An ad.');
    await vi.waitFor(() => expect(t.provider('bonsai-2').calls).toHaveLength(1));
    const cloudStart = vi.spyOn(t.runtimes.cloud, 'ensureRunning');
    const result = await t.service.check({ ai: claude, key: 'sk-typed' });
    expect(result).toMatchObject({ ok: true, models: ['fake-model'] });
    expect(result.detail).toMatch(/^Connected to Claude \(Anthropic API\)\. It replied in \d+ ms\.$/);
    // It didn't wait for the ad being read.
    expect(t.provider('bonsai-2').finished).toEqual([]);
    expect(t.asked.at(-1)).toEqual({ id: 'claude-mine', key: 'sk-typed' });
    expect(await t.service.check({ ai: claude })).toMatchObject({ ok: true });
    expect(t.asked.at(-1)).toEqual({ id: 'claude-mine', key: 'sk-ant-saved' });
    expect(t.provider('claude-mine').calls.map(task)).toEqual(['connection_test', 'connection_test']);
    expect(cloudStart).not.toHaveBeenCalled();
    expect(t.runtimes.managed.background).toEqual([false]);
    expect(t.service.status().id).toBe('bonsai-2');
    await reading;
  });

  it('the AI in use: waits its turn in the queue, and may start its program', async () => {
    const t = setup({ saved: [bonsai], active: 'bonsai-2' });
    const provider = t.provider('bonsai-2');
    provider.delayMs = 100;
    const reading = t.service.parseJob('An ad.');
    expect((await t.service.check({ ai: bonsai })).ok).toBe(true);
    expect(provider.finished.map(task)).toEqual(['parsed_job', 'connection_test']);
    expect(t.runtimes.managed.background).toEqual([false, false]);
    await reading;
  });

  it("testing the AI in use with a key typed in the form never changes the pill, either way", async () => {
    const t = setup({ saved: [claude], active: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    const provider = t.provider('claude-mine');
    const refused = 'Claude – mine refused its API key. Check the key in Settings → AI.';
    await t.service.parseJob('An ad.');
    // A wrong key typed in the form: the saved one still works.
    provider.reply = () => new AiAccountError(refused);
    expect(await t.service.check({ ai: claude, key: 'sk-wrong' })).toMatchObject({ ok: false, detail: refused });
    expect(t.service.status()).toMatchObject({ state: 'ready', detail: null });
    // A real problem with the saved key stays, even after a good test of a typed one.
    await expect(t.service.parseJob('An ad.')).rejects.toThrow(refused);
    provider.reply = defaultReply;
    expect(await t.service.check({ ai: claude, key: 'sk-new' })).toMatchObject({ ok: true });
    expect(t.service.status()).toMatchObject({ state: 'error', detail: refused });
  });

  it('testing the AI in use exactly as saved, with no key typed, counts for the pill, as any task does', async () => {
    const t = setup({ saved: [claude], active: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    const provider = t.provider('claude-mine');
    const limit = "Claude – mine says you've reached a usage limit. Wait a while, or switch to another AI from the AI pill at the top.";
    provider.reply = () => new AiAccountError(limit);
    await expect(t.service.parseJob('An ad.')).rejects.toThrow(limit);
    expect(t.service.status()).toMatchObject({ state: 'error', detail: limit });
    // Later, the limit is lifted. Test connection on the form as it is says so, and so does the pill.
    provider.reply = defaultReply;
    expect(await t.service.check({ ai: JSON.parse(JSON.stringify(claude)) as SavedAi })).toMatchObject({ ok: true });
    expect(t.service.status()).toMatchObject({ state: 'ready', detail: null });
    // A form that differs from what's saved isn't the AI in use: its result stays in the form.
    provider.reply = () => new AiAccountError(limit);
    expect(await t.service.check({ ai: { ...claude, model: 'claude-opus-5-5' } })).toMatchObject({ ok: false, detail: limit });
    expect(t.service.status()).toMatchObject({ state: 'ready', detail: null });
    // The form exactly as saved, failing: the pill shows it, as Test connection always did for the AI as saved.
    expect(await t.service.check({ ai: claude })).toMatchObject({ ok: false, detail: limit });
    expect(t.service.status()).toMatchObject({ state: 'error', detail: limit });
  });

  it('Test connection for the AI in use, as saved, tests the AI in use when its turn comes', async () => {
    const t = setup({ saved: [bonsai, openai], active: 'bonsai-2' });
    t.provider('bonsai-2').delayMs = 100;
    const reading = t.service.parseJob('An ad.');
    await vi.waitFor(() => expect(t.provider('bonsai-2').calls).toHaveLength(1));
    const testing = t.service.test();
    t.use('openai');
    const result = await testing;
    expect(result.detail).toMatch(/^Connected to OpenAI\. It replied in \d+ ms\.$/);
    expect(t.provider('openai').calls.map(task)).toEqual(['connection_test']);
    expect(t.provider('bonsai-2').calls.map(task)).toEqual(['parsed_job']);
    await reading;
  });

  it("a cloud AI's model list is best effort: the test chat decides", async () => {
    const t = setup({ saved: [bonsai, claude], active: 'bonsai-2' });
    const provider = t.provider('claude-mine');
    provider.down = true;
    expect(await t.service.check({ ai: claude, key: 'sk-typed' })).toMatchObject({ ok: true, models: [] });
    const refused = 'Claude – mine refused its API key. Check the key in Settings → AI.';
    provider.reply = () => new AiAccountError(refused);
    expect(await t.service.check({ ai: claude, key: 'sk-typed' })).toEqual({ ok: false, detail: refused, models: [], replyMs: null });
    // Not the AI in use, so the pill doesn't change.
    expect(t.service.status().state).not.toBe('error');
  });

  it('"Pick a model" names the first ten models the server has, then how many more (OpenRouter has hundreds)', async () => {
    const t = setup({ saved: [bonsai, openai], active: 'bonsai-2' });
    const provider = t.provider('openai');
    const noModel = { ...openai, model: '' };
    provider.models = Array.from({ length: 400 }, (_, i) => `model-${i + 1}`);
    const first10 = Array.from({ length: 10 }, (_, i) => `model-${i + 1}`).join(', ');
    expect(await t.service.check({ ai: noModel, key: 'sk-typed' })).toMatchObject({
      ok: false,
      detail: `Pick a model. The server has: ${first10}, and 390 more.`,
    });
    provider.models = Array.from({ length: 11 }, (_, i) => `model-${i + 1}`);
    expect((await t.service.check({ ai: noModel, key: 'sk-typed' })).detail).toBe(`Pick a model. The server has: ${first10}, and 1 more.`);
    // Ten or fewer: all of them.
    provider.models = Array.from({ length: 10 }, (_, i) => `model-${i + 1}`);
    expect((await t.service.check({ ai: noModel, key: 'sk-typed' })).detail).toBe(`Pick a model. The server has: ${first10}.`);
  });

  it("a local AI that isn't running: the test says so, and doesn't start it", async () => {
    const t = setup({ saved: [claude, ollama], active: 'claude-mine' });
    t.provider('ollama').down = true;
    const result = await t.service.check({ ai: ollama });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Can't reach");
    expect(t.runtimes.external.background).toEqual([]);
  });

  it("models() gives the provider's list, or a sentence when it fails", async () => {
    const t = setup({ saved: [bonsai, claude], active: 'bonsai-2' });
    const provider = t.provider('claude-mine');
    provider.models = ['claude-sonnet-5-5', 'claude-opus-5-5'];
    expect(await t.service.models({ ai: claude, key: 'sk-typed' })).toEqual({ ok: true, models: ['claude-sonnet-5-5', 'claude-opus-5-5'], detail: null });
    expect(t.asked.at(-1)).toEqual({ id: 'claude-mine', key: 'sk-typed' });
    provider.down = true;
    const failed = await t.service.models({ ai: claude });
    expect(failed).toMatchObject({ ok: false, models: [] });
    expect(failed.detail).toContain("Can't reach");
  });
});

describe('modelIdentity: which model does the rating', () => {
  const identity = (ai: SavedAi, which: 'rate' | 'card' = 'rate') => setup({ saved: [ai], active: ai.id }).service.modelIdentity(which);
  const withTaskModel = (ai: SavedAi, which: 'rate' | 'card', model: string): SavedAi => ({
    ...ai,
    tasks: { ...ai.tasks, [which]: { ...ai.tasks[which], model } },
  });

  it("the preset and the model the task uses: the task's own, or the AI's", () => {
    const haiku = withTaskModel(claude, 'rate', 'claude-haiku-5-5');
    expect(identity(haiku)).toBe('anthropic|claude-haiku-5-5');
    expect(identity(haiku, 'card')).toBe('anthropic|claude-sonnet-5-5');
    expect(identity(claude)).toBe('anthropic|claude-sonnet-5-5');
    expect(identity(withTaskModel(claude, 'card', 'claude-haiku-5-5'), 'card')).toBe('anthropic|claude-haiku-5-5');
  });

  it('llama-server: the model file, whatever a task names; without one, the AI itself', () => {
    expect(identity(bonsai)).toBe('llama-server|ternary-bonsai-2-27b-pq2_0.gguf');
    expect(identity(withTaskModel(bonsai, 'rate', 'small'))).toBe('llama-server|ternary-bonsai-2-27b-pq2_0.gguf');
    expect(identity(bat('bonsai-2b', 'Bonsai 2B', 'D:\\m\\Bonsai-2B.gguf'))).toBe('llama-server|bonsai-2b.gguf');
    expect(identity(bat('bonsai-2b', 'Bonsai 2B'))).toBe('llama-server|ai:bonsai-2b');
    expect(identity(saved({ id: 'my-ai-server', name: 'My AI server', preset: 'custom', model: '' }))).toBe('custom|ai:my-ai-server');
  });
});

describe('switching while a draft is being written (Review Focus 3)', () => {
  const RESUME = '# Sam Taylor\n\nsam@example.com\n\n## Experience\n\n- Moved the web app to TypeScript.';
  const INPUT: WriteInput = {
    kind: 'resume',
    profile: '# Sam Taylor\nSenior engineer.',
    guide: null,
    job: 'Role: Senior Engineer',
    ad: 'We want someone who knows TypeScript.',
    today: '31 October 2026',
    notes: [],
    brief: null,
  };
  const writes = (provider: FakeAiProvider) => {
    provider.reply = (req) => (req.jsonSchema ? defaultReply(req) : RESUME);
    provider.chunkDelayMs = 15;
  };

  it('the draft finishes on the AI it started on, and a task waiting behind it runs on the new AI', async () => {
    const t = setup({ saved: [claude, openai], active: 'claude-mine' });
    writes(t.provider('claude-mine'));
    const stream = t.service.writeDocument(INPUT)[Symbol.asyncIterator]();
    let text = (await stream.next()).value as string;
    const waiting = t.service.parseJob('An ad.');
    t.use('openai');
    for (let next = await stream.next(); !next.done; next = await stream.next()) text += next.value;
    await waiting;
    expect(text).toBe(RESUME);
    expect(t.provider('claude-mine').finished.map(task)).toEqual(['write']);
    expect(t.provider('openai').finished.map(task)).toEqual(['parsed_job']);
    expect(t.service.status()).toMatchObject({ state: 'ready', id: 'openai' });
  });

  it("if the switch stops the old AI's program, the draft ends with its text so far and the error, and the new AI shows no problem", async () => {
    const t = setup({ saved: [bonsai, claude], active: 'bonsai-2' });
    const old = t.provider('bonsai-2');
    writes(old);
    const { managed } = t.runtimes;
    const stop = managed.stop.bind(managed);
    // Stopping llama-server ends its stream, as a real one does.
    managed.stop = async () => {
      old.cut = new AiUnavailableError("Can't reach Bonsai 2 at http://127.0.0.1:8080/v1. Check that it's running, or pick another AI in Settings.");
      await stop();
    };
    const chunks: string[] = [];
    const err = await (async () => {
      for await (const chunk of t.service.writeDocument(INPUT)) {
        chunks.push(chunk);
        if (chunks.length === 2) t.use('claude-mine');
      }
    })().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect((err as Error).message).toContain("Can't reach Bonsai 2");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(RESUME.startsWith(chunks.join(''))).toBe(true);
    expect(chunks.join('')).not.toBe(RESUME);
    expect(t.service.status()).toMatchObject({ state: 'ready', detail: null, id: 'claude-mine' });
  });
});

describe('switching quickly between two AIs the app starts (Review Focus 4)', () => {
  const fakeLlama = fileURLToPath(new URL('../../../tests/fakes/fake-llama-server.ts', import.meta.url));
  const answers = (port: number) =>
    fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
      .then((r) => r.ok)
      .catch(() => false);
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  // Two llama-servers the app starts, each on its own port, sharing the one
  // runtime as they do in app.ts. Every start's outcome is kept, in order.
  async function twoBonsais(slowStartMs = 0) {
    const ports = { a: await freePort(), b: await freePort() };
    const root = mkdtempSync(join(tmpdir(), 'jr-switch-'));
    const onPort = (id: string, name: string, port: number) =>
      saved({
        id,
        name,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        managed: { enabled: true, exe: process.execPath, args: [fakeLlama, '--port', String(port), '--slow-start-ms', String(slowStartMs)], startTimeoutSec: 20 },
      });
    const spawned: { port: number; child: ChildProcess }[] = [];
    const outcomes: string[] = [];
    const t = setup({
      saved: [onPort('bonsai-a', 'Bonsai A', ports.a), onPort('bonsai-b', 'Bonsai B', ports.b)],
      active: 'bonsai-a',
      runtime: (getConfig) => {
        const managed = createLlamaServerRuntime({
          root,
          logFile: join(root, 'data', 'logs', 'llama.log'),
          pidFile: join(root, 'data', 'llama-server.pid'),
          getConfig,
          spawn: ((cmd: string, args: string[], opts: object) => {
            const child = realSpawn(cmd, args, opts);
            spawned.push({ port: Number(args[args.indexOf('--port') + 1]), child });
            return child;
          }) as typeof realSpawn,
        });
        return {
          ...managed,
          ensureRunning: (signal, opts) =>
            managed.ensureRunning(signal, opts).then(
              () => void outcomes.push('ready'),
              (err: Error) => {
                outcomes.push(err.name);
                throw err;
              },
            ),
        };
      },
    });
    cleanups.push(() => {
      for (const { child } of spawned) if (child.pid && alive(child.pid)) child.kill('SIGKILL');
      rmSync(root, { recursive: true, force: true });
    });
    return { t, ports, spawned, outcomes };
  }

  it('A → B → A in one go: A is in use, and only A is started, once', async () => {
    const { t, ports, spawned, outcomes } = await twoBonsais();
    t.use('bonsai-b');
    t.use('bonsai-a');
    await vi.waitFor(() => expect(outcomes).toContain('ready'), { timeout: 15_000 });
    expect(t.settings.active).toBe('bonsai-a');
    // A start for B, if one began, was cancelled.
    expect(outcomes.filter((o) => o !== 'AbortError')).toEqual(['ready']);
    expect(spawned.map((s) => s.port)).toEqual([ports.a]);
    expect(await answers(ports.a)).toBe(true);
    expect(await answers(ports.b)).toBe(false);
    expect(t.states).not.toContain('error');
    expect(t.service.status()).toMatchObject({ state: 'ready', id: 'bonsai-a' });
  }, 20_000);

  it('A → B → A while A runs: A keeps running, and B never starts', async () => {
    const { t, ports, spawned, outcomes } = await twoBonsais();
    await t.service.parseJob('An ad.');
    const pid = spawned[0]!.child.pid!;
    t.use('bonsai-b');
    t.use('bonsai-a');
    await vi.waitFor(() => expect(outcomes.filter((o) => o === 'ready')).toHaveLength(2), { timeout: 15_000 });
    expect(spawned).toHaveLength(1);
    expect(alive(pid)).toBe(true);
    expect(await answers(ports.b)).toBe(false);
    expect(t.states).not.toContain('error');
  }, 20_000);

  it("switching back while B is starting cancels B's start: an AbortError, never an error, and only A is left running", async () => {
    const { t, ports, spawned, outcomes } = await twoBonsais(1500);
    t.use('bonsai-b');
    await vi.waitFor(() => expect(spawned).toHaveLength(1), { timeout: 5000 });
    t.use('bonsai-a');
    await vi.waitFor(() => expect(outcomes).toEqual(['AbortError', 'ready']), { timeout: 15_000 });
    expect(spawned.map((s) => s.port)).toEqual([ports.b, ports.a]);
    expect(alive(spawned[0]!.child.pid!)).toBe(false);
    expect(await answers(ports.b)).toBe(false);
    expect(await answers(ports.a)).toBe(true);
    expect(t.states).not.toContain('error');
    expect(t.service.status()).toMatchObject({ state: 'ready', id: 'bonsai-a' });
  }, 20_000);
});
