// The writing AI: resumes and cover letters go to the AI you picked to write,
// with its own settings and key. Its problems stay where you write, never on
// the pill. A cloud writer has a lane of its own, so a long draft never holds
// up ratings on the local AI; a local one shares the main queue (one GPU),
// and the app never starts or stops it. These build the AI service on its
// own, with a settings object the tests change, as switch.test.ts does.

import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeAi,
  AI_PRESETS,
  DEFAULT_SETTINGS,
  writingAi,
  type AiSettings,
  type SavedAi,
} from '../../../shared/contracts/index.ts';
import { defaultReply, FakeAiProvider } from '../../../tests/fakes/fake-ai-provider.ts';
import { FakeRuntime } from '../../../tests/fakes/fake-runtime.ts';
import { AiAccountError, AiRefusedError, AiUnavailableError, ReplacedError } from '../../core/errors.ts';
import { createEventBus, type AppEvents } from '../../core/events.ts';
import type { Logger } from '../../core/logger.ts';
import { httpError } from './adapters/http-errors.ts';
import { USE_ANOTHER_AI } from './provider.ts';
import type { ModelRuntime } from './runtime.ts';
import { createCloudRuntime } from './runtime/cloud.ts';
import { createAiService, type AiService, type RateInput, type WriteInput } from './service.ts';

const silent = pino({ level: 'silent' }) as Logger;
const bonsai = activeAi(DEFAULT_SETTINGS.ai);
const saved = (ai: Partial<SavedAi> & Pick<SavedAi, 'id' | 'name'>): SavedAi => ({ ...bonsai, ...ai });
// A second local AI on the same address: your own .bat for a smaller model file.
const light = saved({
  id: 'bonsai-light',
  name: 'Bonsai light',
  model: 'D:\\models\\Bonsai-2B.gguf',
  managed: { ...bonsai.managed, exe: 'D:\\aitest\\Bonsai-light\\start_bonsai.bat' },
});
// Claude, with writing settings of its own.
const claude = saved({
  id: 'claude-mine',
  name: 'Claude – mine',
  preset: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  model: 'claude-sonnet-5-5',
  tasks: {
    ...bonsai.tasks,
    write: { ...bonsai.tasks.write, model: 'claude-opus-5-5', temperature: 0.4, maxTokens: 16000, thinkingEffort: 'high' },
  },
});

const LETTER = 'Dear Alex,\n\nI moved the Example Co web app to TypeScript.\n\nSam Taylor';
const INPUT: WriteInput = {
  kind: 'cover_letter',
  profile: '# Sam Taylor\nSenior engineer. Moved the web app to TypeScript.',
  guide: null,
  job: 'Role: Senior Engineer\nCompany: Example Co',
  ad: 'We want someone who knows TypeScript. Contact Alex at example-recruit.com.au.',
  today: '3 November 2026',
  notes: [],
  brief: null,
};
const RATE: RateInput = { profile: 'I write TypeScript.', preferences: null, ad: 'We need TypeScript.' };
const REFUSED = 'Claude – mine refused its API key. Check the key in Settings → AI.';

const task = (c: { jsonSchema?: { name: string } }) => c.jsonSchema?.name ?? 'write';
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

// The rest of a draft whose first chunk was read already.
async function rest(stream: AsyncIterator<string>): Promise<string> {
  let text = '';
  for (let next = await stream.next(); !next.done; next = await stream.next()) text += next.value;
  return text;
}

// A promise you settle by hand, to hold a task open.
function held() {
  let release!: () => void;
  const opened = new Promise<void>((r) => (release = r));
  return { release, opened };
}

const services: AiService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
});

// Bonsai 2 is in use (the app starts it), unless active says otherwise.
// Bonsai light and Claude – mine are saved too.
function setup(o: { writer: string | null; active?: string; keys?: Record<string, string> }) {
  const bus = createEventBus(silent);
  const settings: AiSettings = { active: o.active ?? 'bonsai-2', writer: o.writer, saved: [bonsai, light, claude] };
  const getConfig = () => activeAi(settings);
  const providers = new Map<string, FakeAiProvider>();
  const provider = (id: string): FakeAiProvider => {
    if (!providers.has(id)) {
      // Each AI writes the letter, and answers every other task as the fake does.
      providers.set(id, new FakeAiProvider((req) => (req.jsonSchema ? defaultReply(req) : LETTER)));
    }
    return providers.get(id)!;
  };
  // Which AI, and which key, each provider was made for.
  const asked: { id: string; key: string | null }[] = [];
  const runtimes = { managed: new FakeRuntime(), external: new FakeRuntime(), cloud: createCloudRuntime() };
  const runtime = (): ModelRuntime => {
    const ai = getConfig();
    if (AI_PRESETS[ai.preset].group === 'cloud') return runtimes.cloud;
    return ai.preset === 'llama-server' && ai.managed.enabled ? runtimes.managed : runtimes.external;
  };
  const service = createAiService({
    providerFor: (ai, key) => {
      asked.push({ id: ai.id, key });
      return provider(ai.id);
    },
    getKey: (id) => o.keys?.[id] ?? null,
    getAll: () => settings.saved,
    runtime,
    getConfig,
    getWriter: () => {
      const w = writingAi(settings);
      return { ai: w.ai, inUse: w.inUse };
    },
    bus,
    logger: silent,
    now: () => new Date(),
  });
  services.push(service);
  // Everything the pill was told.
  const events: AppEvents['ai.stateChanged'][] = [];
  bus.on('ai.stateChanged', (e) => events.push(e));
  // What PUT /settings/ai/writer does: save, then say so.
  const useWriter = (id: string | null) => {
    settings.writer = id;
    bus.emit('settings.changed', { keys: ['ai'] });
  };
  // Bonsai 2 started and ready, as after a task.
  const ready = async () => {
    await service.parseJob('An ad.');
    expect(service.status()).toMatchObject({ state: 'ready', detail: null, id: 'bonsai-2' });
    events.length = 0;
  };
  return { service, provider, asked, runtimes, events, settings, useWriter, ready };
}

describe('which AI writes', () => {
  it('with no writing AI picked, the AI in use writes, as before: through the main queue, with the pill', async () => {
    const t = setup({ writer: null });
    expect(await collect(t.service.writeDocument(INPUT))).toBe(LETTER);
    expect(t.provider('bonsai-2').calls.map(task)).toEqual(['write']);
    expect(t.provider('claude-mine').calls).toEqual([]);
    expect(t.provider('bonsai-light').calls).toEqual([]);
    expect(t.runtimes.managed.background).toEqual([false]);
    expect(t.events.map((e) => e.state)).toEqual(['starting', 'ready', 'busy', 'ready']);
  });

  it("with Claude picked, Claude writes with its own writing settings and key, and ratings stay on the AI in use", async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    expect(await collect(t.service.writeDocument(INPUT))).toBe(LETTER);
    const [req] = t.provider('claude-mine').callsFor('write');
    expect(req).toMatchObject({ model: 'claude-opus-5-5', temperature: 0.4, maxTokens: 16000, thinking: true, thinkingEffort: 'high' });
    expect(t.asked).toEqual([{ id: 'claude-mine', key: 'sk-ant-saved' }]);
    // Nothing started for it, and the pill heard nothing.
    expect(t.runtimes.managed.background).toEqual([]);
    expect(t.events).toEqual([]);

    await t.service.rateJob(RATE);
    expect(t.provider('bonsai-2').calls.map(task)).toEqual(['rating']);
    expect(t.provider('claude-mine').calls.map(task)).toEqual(['write']);
    expect(t.asked.at(-1)).toEqual({ id: 'bonsai-2', key: null });
  });

  it('a Claude draft runs while a slow Bonsai 2 rating holds the main queue', async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    const rating = held();
    t.provider('bonsai-2').reply = async (req) => {
      await rating.opened;
      return defaultReply(req);
    };
    const rated = t.service.rateJob(RATE);
    await vi.waitFor(() => expect(t.provider('bonsai-2').calls).toHaveLength(1));
    // The whole draft, while the rating is still running.
    expect(await collect(t.service.writeDocument(INPUT))).toBe(LETTER);
    expect(t.provider('claude-mine').finished.map(task)).toEqual(['write']);
    expect(t.provider('bonsai-2').finished).toEqual([]);
    expect(t.service.status().state).toBe('busy');
    rating.release();
    await expect(rated).resolves.toMatchObject({ rating: { score: 72 } });
  });

  it("Claude's lane runs one draft at a time: the second waits until the first ends", async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    const first = held();
    let replies = 0;
    t.provider('claude-mine').reply = async () => {
      if (replies++ === 0) await first.opened;
      return LETTER;
    };
    const resume = collect(t.service.writeDocument({ ...INPUT, kind: 'resume' }, { key: 'doc-1-resume' }));
    await vi.waitFor(() => expect(t.provider('claude-mine').calls).toHaveLength(1));
    const letter = collect(t.service.writeDocument(INPUT, { key: 'doc-1-cover_letter' }));
    await tick();
    expect(t.provider('claude-mine').calls).toHaveLength(1);
    first.release();
    expect(await resume).toBe(LETTER);
    expect(await letter).toBe(LETTER);
    expect(t.provider('claude-mine').finished).toHaveLength(2);
  });

  it("a Claude failure fails the draft, and never reaches the pill", async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-old' } });
    await t.ready();
    t.provider('claude-mine').reply = () => new AiAccountError(REFUSED);
    await expect(collect(t.service.writeDocument(INPUT))).rejects.toThrow(REFUSED);
    expect(t.service.status()).toMatchObject({ state: 'ready', detail: null, id: 'bonsai-2' });
    expect(t.events).toEqual([]);
    // The AI in use still works.
    await t.service.rateJob(RATE);
    expect(t.service.status()).toMatchObject({ state: 'ready', detail: null });
  });

  it("a writer id that isn't saved any more: the AI in use writes", async () => {
    const t = setup({ writer: 'claude-gone' });
    expect(await collect(t.service.writeDocument(INPUT))).toBe(LETTER);
    expect(t.provider('bonsai-2').calls.map(task)).toEqual(['write']);
    expect(t.events.map((e) => e.state)).toContain('busy');
  });

  it('a draft waiting for the AI in use, when the writer becomes Claude, runs on Claude, and the pill stays out of it', async () => {
    const t = setup({ writer: null, keys: { 'claude-mine': 'sk-ant-saved' } });
    await t.ready();
    const rating = held();
    t.provider('bonsai-2').reply = async (req) => {
      await rating.opened;
      return defaultReply(req);
    };
    const rated = t.service.rateJob(RATE);
    await vi.waitFor(() => expect(t.provider('bonsai-2').calls).toHaveLength(2));
    const draft = collect(t.service.writeDocument(INPUT));
    await tick();
    t.useWriter('claude-mine');
    const before = t.events.length;
    rating.release();
    await rated;
    expect(await draft).toBe(LETTER);
    expect(t.provider('claude-mine').calls.map(task)).toEqual(['write']);
    expect(t.provider('bonsai-2').calls.map(task)).toEqual(['parsed_job', 'rating']);
    // Only the rating's end: the draft never showed as busy.
    expect(t.events.slice(before).map((e) => e.state)).toEqual(['ready']);
  });
});

// Where you write shows who's writing: the writer picked as the task is
// queued, then the AI it runs on as it starts.
describe("who's writing", () => {
  it('a draft or a brief on Claude says Claude, as it is queued and as it starts', async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    const told: string[] = [];
    const o = { onQueued: (by: string) => told.push(`queued ${by}`), onStart: (by: string) => told.push(`started ${by}`) };
    await collect(t.service.writeDocument(INPUT, o));
    await t.service.briefJob({ profile: INPUT.profile, job: INPUT.job, ad: INPUT.ad, notes: [], answers: [], today: INPUT.today }, o);
    expect(told).toEqual(['queued Claude – mine', 'started Claude – mine', 'queued Claude – mine', 'started Claude – mine']);
  });

  it('a draft waiting while the writer becomes Claude is queued for Bonsai 2 and starts on Claude', async () => {
    const t = setup({ writer: null, keys: { 'claude-mine': 'sk-ant-saved' } });
    await t.ready();
    const rating = held();
    t.provider('bonsai-2').reply = async (req) => {
      await rating.opened;
      return defaultReply(req);
    };
    const rated = t.service.rateJob(RATE);
    await vi.waitFor(() => expect(t.provider('bonsai-2').calls).toHaveLength(2));
    const told: string[] = [];
    const draft = collect(t.service.writeDocument(INPUT, { onQueued: (by) => told.push(`queued ${by}`), onStart: (by) => told.push(`started ${by}`) }));
    await vi.waitFor(() => expect(told).toEqual(['queued Bonsai 2']));
    t.useWriter('claude-mine');
    rating.release();
    await rated;
    expect(await draft).toBe(LETTER);
    expect(told).toEqual(['queued Bonsai 2', 'started Claude – mine']);
  });

  it('a draft cancelled before it was asked for is never queued', async () => {
    const t = setup({ writer: null });
    const onQueued = vi.fn();
    await expect(collect(t.service.writeDocument(INPUT, { signal: AbortSignal.abort(), onQueued }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(onQueued).not.toHaveBeenCalled();
  });
});

// The pill changes the AI in use, not the writing AI. So a writing AI that
// isn't the AI in use points to where you pick the writer instead.
describe("a writing AI's advice when it can't go on", () => {
  const BRIEF_INPUT = { profile: INPUT.profile, job: INPUT.job, ad: INPUT.ad, notes: [], answers: [], today: INPUT.today };
  const claudeConfig = { name: claude.name, preset: claude.preset, baseUrl: claude.baseUrl, model: claude.model, timeoutSec: 60, apiKey: 'sk-ant-saved', dialect: AI_PRESETS.anthropic.dialect };
  // As Claude's connector says them, for the AI in use.
  const limit = () => httpError(429, JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Too many requests' } }), claudeConfig);
  const declined = () => new AiRefusedError(`${claude.name} declined to answer this request. You can ${USE_ANOTHER_AI}.`);

  it('a usage limit on Claude, writing while Bonsai 2 is in use, says to pick another writing AI, and is still an account problem', async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    t.provider('claude-mine').reply = limit;
    const err = await collect(t.service.writeDocument(INPUT)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiAccountError);
    expect((err as Error).message).toBe(
      "Claude – mine says you've reached a usage limit. Wait a while, or pick another writing AI beside the button, or in Settings → AI.",
    );
    // A brief the same way.
    await expect(t.service.briefJob(BRIEF_INPUT)).rejects.toThrow('Wait a while, or pick another writing AI beside the button, or in Settings → AI.');
  });

  it('a declined request on Claude, writing while Bonsai 2 is in use, says the same, and is still about this request', async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    t.provider('claude-mine').reply = declined;
    const err = await collect(t.service.writeDocument(INPUT)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusedError);
    expect((err as Error).message).toBe('Claude – mine declined to answer this request. You can pick another writing AI beside the button, or in Settings → AI.');
  });

  it('Claude writing as the AI in use keeps the advice to use the AI pill', async () => {
    const t = setup({ writer: null, active: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    t.provider('claude-mine').reply = limit;
    await expect(collect(t.service.writeDocument(INPUT))).rejects.toThrow(
      "Claude – mine says you've reached a usage limit. Wait a while, or switch to another AI from the AI pill at the top.",
    );
  });
});

describe('a local writing AI that is not the AI in use', () => {
  it('writes through the main queue, after the task holding the GPU, and is never started', async () => {
    const t = setup({ writer: 'bonsai-light' });
    await t.ready();
    const rating = held();
    t.provider('bonsai-2').reply = async (req) => {
      await rating.opened;
      return defaultReply(req);
    };
    const rated = t.service.rateJob(RATE);
    await vi.waitFor(() => expect(t.provider('bonsai-2').calls).toHaveLength(2));
    const draft = collect(t.service.writeDocument(INPUT));
    await tick();
    expect(t.provider('bonsai-light').calls).toEqual([]);
    rating.release();
    await rated;
    expect(await draft).toBe(LETTER);
    expect(t.provider('bonsai-light').calls.map(task)).toEqual(['write']);
    // Only Bonsai 2's own tasks asked for a program.
    expect(t.runtimes.managed.background).toEqual([false, false]);
    expect(t.runtimes.external.background).toEqual([]);
    // The rating's busy and ready, and nothing for the draft.
    expect(t.events.map((e) => e.state)).toEqual(['busy', 'ready']);
  });

  it('with a cloud AI in use, it still waits in the main queue behind the task running there', async () => {
    const t = setup({ writer: 'bonsai-light', active: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    const rating = held();
    t.provider('claude-mine').reply = async (req) => {
      await rating.opened;
      return defaultReply(req);
    };
    const rated = t.service.rateJob(RATE);
    await vi.waitFor(() => expect(t.provider('claude-mine').calls).toHaveLength(1));
    const draft = collect(t.service.writeDocument(INPUT));
    await tick();
    expect(t.provider('bonsai-light').calls).toEqual([]);
    rating.release();
    await rated;
    expect(await draft).toBe(LETTER);
    expect(t.provider('bonsai-light').calls.map(task)).toEqual(['write']);
    expect(t.provider('claude-mine').calls.map(task)).toEqual(['rating']);
    // Nothing started for it, and only the rating showed as busy.
    expect(t.runtimes.managed.background).toEqual([]);
    expect(t.runtimes.external.background).toEqual([]);
    expect(t.events.filter((e) => e.state === 'busy')).toHaveLength(1);
  });

  it("isn't running: the draft fails with its provider's own sentence, nothing starts, and the pill stays as it was", async () => {
    const t = setup({ writer: 'bonsai-light' });
    await t.ready();
    t.provider('bonsai-light').down = true;
    const err = await collect(t.service.writeDocument(INPUT)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect((err as Error).message).toBe("Can't reach the AI at http://fake/v1. Check that it's running, or pick another AI in Settings.");
    expect(t.provider('bonsai-light').calls).toEqual([]);
    expect(t.runtimes.managed.background).toEqual([false]);
    expect(t.runtimes.external.background).toEqual([]);
    expect(t.service.status()).toMatchObject({ state: 'ready', detail: null, id: 'bonsai-2' });
    expect(t.events).toEqual([]);
  });

  it("with no sentence from its provider, says it can't reach it, by name and address", async () => {
    const t = setup({ writer: 'bonsai-light' });
    vi.spyOn(t.provider('bonsai-light'), 'health').mockResolvedValue({ ok: false, models: [], detail: null });
    await expect(collect(t.service.writeDocument(INPUT))).rejects.toThrow(
      "Can't reach Bonsai light at http://127.0.0.1:8080/v1. Check that it's running, or pick another AI in Settings.",
    );
  });

  it("another AI's model answering on its address: the model-file check says so, where you write", async () => {
    const t = setup({ writer: 'bonsai-light' });
    await t.ready();
    t.provider('bonsai-light').models = ['ai/models/Ternary-Bonsai-2-27B-PQ2_0.gguf'];
    await expect(collect(t.service.writeDocument(INPUT))).rejects.toThrow(
      'Bonsai 2 is still running on 127.0.0.1:8080. Close its window, then try again.',
    );
    expect(t.provider('bonsai-light').calls).toEqual([]);
    expect(t.service.status()).toMatchObject({ state: 'ready', detail: null });
    expect(t.events).toEqual([]);
  });
});

describe('the writing AI changes while a draft runs (Review Focus 4)', () => {
  it('the draft finishes on the AI it started on, and the next one goes to the new writer', async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    t.provider('claude-mine').chunkDelayMs = 15;
    const stream = t.service.writeDocument(INPUT)[Symbol.asyncIterator]();
    const text = (await stream.next()).value as string;
    t.useWriter('bonsai-light');
    expect(text + (await rest(stream))).toBe(LETTER);
    expect(t.provider('claude-mine').finished.map(task)).toEqual(['write']);
    expect(await collect(t.service.writeDocument(INPUT))).toBe(LETTER);
    expect(t.provider('bonsai-light').finished.map(task)).toEqual(['write']);
    expect(t.provider('claude-mine').calls).toHaveLength(1);
  });

  it('deleted while it writes: the draft finishes on it, and the next one runs on the AI in use', async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    t.provider('claude-mine').chunkDelayMs = 15;
    const stream = t.service.writeDocument(INPUT)[Symbol.asyncIterator]();
    const text = (await stream.next()).value as string;
    // A hand edit that removes it: the writer still names it.
    t.settings.saved = [bonsai, light];
    t.useWriter('claude-mine');
    expect(text + (await rest(stream))).toBe(LETTER);
    expect(t.provider('claude-mine').finished.map(task)).toEqual(['write']);
    expect(await collect(t.service.writeDocument(INPUT))).toBe(LETTER);
    expect(t.provider('bonsai-2').finished.map(task)).toEqual(['write']);
  });
});

describe('"latest wins" across lanes', () => {
  it('a draft on Claude is cancelled by a newer one with the same key on the AI in use', async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    t.provider('claude-mine').chunkDelayMs = 15;
    const first = t.service.writeDocument(INPUT, { key: 'doc-1-resume' })[Symbol.asyncIterator]();
    await first.next();
    expect(t.provider('claude-mine').calls.map(task)).toEqual(['write']);
    t.useWriter('bonsai-2');
    const second = collect(t.service.writeDocument(INPUT, { key: 'doc-1-resume' }));
    // Replaced, so the reply still being read can say so.
    await expect(rest(first)).rejects.toBeInstanceOf(ReplacedError);
    expect(await second).toBe(LETTER);
    expect(t.provider('claude-mine').finished).toEqual([]);
    expect(t.provider('bonsai-2').finished.map(task)).toEqual(['write']);
  });

  it('a draft on the AI in use is cancelled by a newer one with the same key on Claude', async () => {
    const t = setup({ writer: null, keys: { 'claude-mine': 'sk-ant-saved' } });
    t.provider('bonsai-2').chunkDelayMs = 15;
    const first = t.service.writeDocument(INPUT, { key: 'doc-1-resume' })[Symbol.asyncIterator]();
    await first.next();
    expect(t.provider('bonsai-2').calls.map(task)).toEqual(['write']);
    t.useWriter('claude-mine');
    const second = collect(t.service.writeDocument(INPUT, { key: 'doc-1-resume' }));
    await expect(rest(first)).rejects.toBeInstanceOf(ReplacedError);
    expect(await second).toBe(LETTER);
    expect(t.provider('bonsai-2').finished).toEqual([]);
    expect(t.provider('claude-mine').finished.map(task)).toEqual(['write']);
  });

  it('a draft cancelled before it was asked for cancels nothing, in any lane', async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    t.provider('claude-mine').chunkDelayMs = 10;
    const first = collect(t.service.writeDocument(INPUT, { key: 'doc-1-resume' }));
    await vi.waitFor(() => expect(t.provider('claude-mine').calls).toHaveLength(1));
    t.useWriter(null);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(collect(t.service.writeDocument(INPUT, { key: 'doc-1-resume', signal: cancelled.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(await first).toBe(LETTER);
    expect(t.provider('bonsai-2').calls).toEqual([]);
  });

  it('another key on another lane carries on', async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    t.provider('claude-mine').chunkDelayMs = 10;
    const first = collect(t.service.writeDocument(INPUT, { key: 'doc-1-resume' }));
    await vi.waitFor(() => expect(t.provider('claude-mine').calls).toHaveLength(1));
    t.useWriter(null);
    expect(await collect(t.service.writeDocument(INPUT, { key: 'doc-2-resume' }))).toBe(LETTER);
    expect(await first).toBe(LETTER);
  });
});

describe('stopping covers every lane', () => {
  it('stop() cancels a running Claude draft', async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    t.provider('claude-mine').chunkDelayMs = 15;
    const stream = t.service.writeDocument(INPUT)[Symbol.asyncIterator]();
    await stream.next();
    expect(t.provider('claude-mine').calls.map(task)).toEqual(['write']);
    const reading = rest(stream);
    await t.service.stop();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(t.provider('claude-mine').finished).toEqual([]);
  });

  it('stopNow() cancels a running Claude draft too', async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    t.provider('claude-mine').chunkDelayMs = 15;
    const stream = t.service.writeDocument(INPUT)[Symbol.asyncIterator]();
    await stream.next();
    expect(t.provider('claude-mine').calls.map(task)).toEqual(['write']);
    const reading = rest(stream);
    t.service.stopNow();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(t.provider('claude-mine').finished).toEqual([]);
  });

  it("onIdle() waits for Claude's lane as well as the main queue", async () => {
    const t = setup({ writer: 'claude-mine', keys: { 'claude-mine': 'sk-ant-saved' } });
    t.provider('claude-mine').chunkDelayMs = 10;
    const draft = collect(t.service.writeDocument(INPUT));
    await vi.waitFor(() => expect(t.provider('claude-mine').calls).toHaveLength(1));
    await t.service.onIdle();
    expect(t.provider('claude-mine').finished.map(task)).toEqual(['write']);
    expect(await draft).toBe(LETTER);
  });
});

// The check before a draft (is it running, is it its own model) can't be
// cancelled part-way. A draft cancelled during it must still never start:
// no request is sent. onStart sits just before the work, after the same
// check, so it isn't told either (Task 4's briefs and plans test onStart).
describe('a draft cancelled during the check before it starts', () => {
  // A health check that waits until released.
  function slowHealth(provider: FakeAiProvider) {
    const check = held();
    const health = vi.spyOn(provider, 'health').mockImplementation(async () => {
      await check.opened;
      return { ok: true, models: ['fake-model'], detail: null };
    });
    return { health, release: check.release };
  }

  it('on a local writing AI that is not in use: it rejects as cancelled, and sends nothing', async () => {
    const t = setup({ writer: 'bonsai-light' });
    const { health, release } = slowHealth(t.provider('bonsai-light'));
    const controller = new AbortController();
    const draft = collect(t.service.writeDocument(INPUT, { signal: controller.signal }));
    await vi.waitFor(() => expect(health).toHaveBeenCalled());
    controller.abort();
    await expect(draft).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await t.service.onIdle();
    expect(t.provider('bonsai-light').calls).toEqual([]);
  });

  it('on the AI in use (its model-file check): it rejects as cancelled, and sends nothing', async () => {
    const t = setup({ writer: null });
    const { health, release } = slowHealth(t.provider('bonsai-2'));
    const controller = new AbortController();
    const draft = collect(t.service.writeDocument(INPUT, { signal: controller.signal }));
    await vi.waitFor(() => expect(health).toHaveBeenCalled());
    controller.abort();
    await expect(draft).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await t.service.onIdle();
    expect(t.provider('bonsai-2').calls).toEqual([]);
    expect(t.service.status()).toMatchObject({ state: 'ready', detail: null });
  });
});
