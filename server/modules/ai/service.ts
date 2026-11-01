// The ai module's logic: runs AI tasks one at a time through the queue, makes
// sure the AI program is running first, and keeps track of the AI's state for
// the header pill. It knows nothing about jobs: text in, typed results out.
// Each task goes to the AI in use, through that AI's own provider and key. A
// switch to an AI whose program the app runs starts it at once.

import {
  AI_PRESETS,
  expectedModelFile,
  type AiCheckRequest,
  type AiModelsResult,
  type AiState,
  type AiStatus,
  type AiTestResult,
  type CardRating,
  type EmailClassification,
  type ParsedJob,
  type Rating,
  type SavedAi,
} from '../../../shared/contracts/index.ts';
import type { Clock } from '../../core/config.ts';
import { AiAnswerError, AiUnavailableError } from '../../core/errors.ts';
import type { AppEvents, EventBus } from '../../core/events.ts';
import type { Logger } from '../../core/logger.ts';
import { loadPrompt, PROMPTS_DIR } from './prompts.ts';
import type { AiProvider } from './provider.ts';
import { createAiQueue, type Priority } from './queue.ts';
import type { ModelRuntime } from './runtime.ts';
import { classifyEmailTask, type ClassifyInput } from './tasks/classify-email.ts';
import { parseJobTask } from './tasks/parse-job.ts';
import { rateCardTask, type CardInput } from './tasks/rate-card.ts';
import { rateJobTask, type RateInput } from './tasks/rate-job.ts';
import { writeDocumentTask, type WriteInput } from './tasks/write-document.ts';

export type { CardInput, ClassifyInput, Priority, RateInput, WriteInput };

export interface AiService {
  parseJob(adText: string, opts?: { signal?: AbortSignal; priority?: Priority }): Promise<ParsedJob>;
  // A rating comes with the model that made it, as modelIdentity puts it.
  // That's the AI the task ran on, which may not be the one in use when it
  // was asked for: a rating that waited through a switch runs on the new AI.
  rateJob(input: RateInput, opts?: { signal?: AbortSignal; key?: string; priority?: Priority }): Promise<{ rating: Rating; model: string }>;
  // A quick rating from one card in a search list. It waits behind anything
  // you're waiting for, but goes before reading saved ads.
  rateCard(input: CardInput, opts?: { signal?: AbortSignal; key?: string; priority?: Priority }): Promise<{ rating: CardRating; model: string }>;
  // A resume or cover letter, as it's written. It holds the AI until the
  // stream ends, is cancelled, or the reader stops early.
  writeDocument(input: WriteInput, opts?: { signal?: AbortSignal; key?: string }): AsyncIterable<string>;
  // What one email means. Background work, so anything you're waiting for goes first.
  classifyEmail(input: ClassifyInput, opts?: { signal?: AbortSignal; priority?: Priority }): Promise<EmailClassification>;
  status(): AiStatus;
  // Test connection for the AI in use, as saved.
  test(): Promise<AiTestResult>;
  // Test connection for any AI, saved or not, with the key you typed. It
  // never saves anything. Only the AI in use waits in the queue, and only it
  // may start its program. The AI in use exactly as saved, with no key
  // typed, is the same test as test(), so the pill follows it.
  check(req: AiCheckRequest): Promise<AiTestResult>;
  // Any AI's model list, with the key you typed. It never waits in the queue.
  models(req: AiCheckRequest): Promise<AiModelsResult>;
  // Which model the AI in use does this task's ratings with, so each model
  // keeps its own: the preset and the model the task uses.
  modelIdentity(task: 'rate' | 'card'): string;
  stop(): Promise<void>;
  // At once, with no waiting: for a crash or the app exiting.
  stopNow(): void;
  onIdle(): Promise<void>;
}

export type AiOptions = {
  // A provider for one AI, with its key. app.ts picks the connector.
  providerFor: (ai: SavedAi, key: string | null) => AiProvider;
  // A saved AI's API key, or null.
  getKey: (id: string) => string | null;
  // Every saved AI: to say whose model is still running.
  getAll: () => SavedAi[];
  // The runtime for the AI in use.
  runtime: () => ModelRuntime;
  // The AI in use.
  getConfig: () => SavedAi;
  bus: EventBus;
  logger: Logger;
  now: Clock;
  promptsDir?: string;
};

type AiStateEvent = AppEvents['ai.stateChanged'];

const isAbort = (err: unknown): boolean => (err as Error)?.name === 'AbortError';

// The app runs this AI's program (Bonsai 2's llama-server), so a switch to it starts it.
const startsAtOnce = (ai: SavedAi): boolean => AI_PRESETS[ai.preset].managed && ai.managed.enabled;

const originOf = (baseUrl: string): string | null => {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return null;
  }
};

// When another model answers on a llama-server AI's address: a sentence that
// says whose it is. Only when the app knows which file this AI runs, and the
// server lists a model file (an alias, or no list at all, can't tell).
function wrongModelFile(ai: SavedAi, all: SavedAi[], models: string[]): string | null {
  const expected = expectedModelFile(ai);
  if (expected === null) return null;
  const files = models.map((m) => m.trim().replaceAll('\\', '/').split('/').pop()!).filter((file) => /\.gguf$/i.test(file));
  const running = new Set(files.map((file) => file.toLowerCase()));
  if (running.size === 0 || running.has(expected)) return null;
  const host = new URL(ai.baseUrl).host;
  // The saved AI that runs that file, one on this address first.
  const others = all.filter((one) => one.id !== ai.id && running.has(expectedModelFile(one) ?? ''));
  const other = others.find((one) => originOf(one.baseUrl) === originOf(ai.baseUrl)) ?? others[0];
  if (other) return `${other.name} is still running on ${host}. Close its window, then try again.`;
  return `Another model (${files[0]}) is running on ${host}, not ${ai.name}'s (${expected}). Close it, then try again.`;
}

// The first ten of a list, then how many more: OpenRouter lists hundreds
// of models, too many for one sentence.
const SHOWN = 10;
function someOf(list: string[]): string {
  const shown = list.slice(0, SHOWN).join(', ');
  return list.length > SHOWN ? `${shown}, and ${list.length - SHOWN} more` : shown;
}

// Which model one AI rates with: the preset and the model the task uses.
// llama-server runs one model, whatever a task names: its file decides.
// With no model known, the AI itself stands in.
function identityOf(ai: SavedAi, task: 'rate' | 'card'): string {
  const model = ai.preset === 'llama-server' ? expectedModelFile(ai) : ai.tasks[task].model?.trim() || ai.model.trim() || null;
  return `${ai.preset}|${model ?? `ai:${ai.id}`}`;
}

export function createAiService(opts: AiOptions): AiService {
  const queue = createAiQueue();
  const dir = opts.promptsDir ?? PROMPTS_DIR;
  const prompts = {
    parse: loadPrompt(dir, 'parse-job'),
    rate: loadPrompt(dir, 'rate-job'),
    card: loadPrompt(dir, 'rate-card'),
    resume: loadPrompt(dir, 'write-resume'),
    cover_letter: loadPrompt(dir, 'write-cover-letter'),
    email: loadPrompt(dir, 'classify-email'),
  };

  let busy = 0;
  // Set when the server failed during a task, cleared by the next good one,
  // by a change to the AI in use, or by a new key for it.
  let failure: string | null = null;
  // The AI in use's key when that failure was set, so a new key clears it.
  let failureKey: string | null = null;
  let runtime: ModelRuntime | null = null;
  let unsubscribe: (() => void) | null = null;
  // What the dashboard was last told: the state, and which AI it's about.
  let last: AiStateEvent = { state: 'off', detail: null, id: opts.getConfig().id, name: opts.getConfig().name };
  // The AI in use when the settings last changed, to tell a switch from an
  // edit, and how it was then, to tell an edit to it from a save that left
  // it as it was.
  let inUse = opts.getConfig().id;
  let inUseAs = JSON.stringify(opts.getConfig());
  // Goes up at each switch, so a task that ran on the AI before can't set
  // the state of the one now in use.
  let switches = 0;
  // The start a switch began, so switching again can cancel it.
  let switchStart: AbortController | null = null;

  function current(): { state: AiState; detail: string | null } {
    if (busy > 0) return { state: 'busy', detail: null };
    if (failure) return { state: 'error', detail: failure };
    const rt = runtime ?? opts.runtime();
    const state = rt.state();
    return { state, detail: state === 'error' ? rt.detail() : null };
  }

  // Tells the dashboard when the state changes, or the AI in use does (a
  // switch, a rename), even when the state stays the same.
  function publish(): void {
    const ai = opts.getConfig();
    const next: AiStateEvent = { ...current(), id: ai.id, name: ai.name };
    if (next.state === last.state && next.detail === last.detail && next.id === last.id && next.name === last.name) return;
    last = next;
    opts.bus.emit('ai.stateChanged', next);
  }

  // The runtime follows the settings. When it changes (say, from Bonsai to
  // Ollama), the old one is stopped, so it stops holding GPU memory.
  async function useRuntime(): Promise<ModelRuntime> {
    const wanted = opts.runtime();
    if (wanted !== runtime) {
      const old = runtime;
      unsubscribe?.();
      runtime = wanted;
      unsubscribe = wanted.onStateChange(() => publish());
      failure = null;
      if (old) await old.stop().catch((err: unknown) => opts.logger.warn({ err }, 'Stopping the old AI runtime failed'));
      publish();
    }
    return wanted;
  }

  // The key to send to an AI: the one you typed, or else its saved one. An
  // AI that takes no key never reads secrets.json, so a broken file can't
  // stop it. A saved key goes only to the kind of AI it was saved for.
  function keyFor(ai: SavedAi, typed?: string): string | null {
    if (AI_PRESETS[ai.preset].key === 'none') return null;
    // A pasted key can bring spaces or a newline with it. No key has any.
    if (typed !== undefined) return typed.replace(/\s+/g, '') || null;
    const saved = opts.getAll().find((one) => one.id === ai.id);
    return saved?.preset === ai.preset ? opts.getKey(ai.id) : null;
  }

  const providerOf = (ai: SavedAi, typed?: string): AiProvider => opts.providerFor(ai, keyFor(ai, typed));

  // The AI in use's saved key. A broken secrets.json counts as none: this
  // is only to see whether the key changed.
  function savedKey(): string | null {
    try {
      return keyFor(opts.getConfig());
    } catch {
      return null;
    }
  }

  // The AI in use has a problem: the pill shows it, until it's cleared.
  function fail(message: string): void {
    failure = message;
    failureKey = savedKey();
  }

  // Another model answering on a llama-server AI's address, in a sentence.
  // Only asked when the app knows the file it should run. A server that
  // doesn't answer lists nothing: the task itself then says what's wrong.
  async function modelProblem(ai: SavedAi, provider: AiProvider): Promise<string | null> {
    if (expectedModelFile(ai) === null) return null;
    const health = await provider.health().catch(() => null);
    return wrongModelFile(ai, opts.getAll(), health?.ok ? health.models : []);
  }

  // Runs work in the queue once the AI in use's program is running, and
  // keeps the pill up to date. With status false, the work's result doesn't
  // count for the pill: it isn't about the AI in use as saved.
  function queued<T>(
    priority: Priority,
    key: string | undefined,
    signal: AbortSignal | undefined,
    work: (signal: AbortSignal) => Promise<T>,
    o: { status?: boolean } = {},
  ) {
    const status = o.status ?? true;
    return queue.run({
      priority,
      key,
      signal,
      work: async (sig) => {
        let rt: ModelRuntime;
        let at: number;
        // A switch while this task waits for the AI's program (which may stop
        // that program) means it waits for the new AI's instead.
        for (;;) {
          at = switches;
          rt = await useRuntime();
          try {
            await rt.ensureRunning(sig, { background: priority === 'background' });
          } catch (err) {
            if (switches !== at && !sig.aborted) continue;
            publish();
            throw err;
          }
          if (switches === at) break;
        }
        busy++;
        publish();
        try {
          const value = await work(sig);
          if (status && at === switches) failure = null;
          return value;
        } catch (err) {
          // A task that ran on the AI before a switch says nothing about the one in use now.
          if (status && at === switches && err instanceof AiUnavailableError && !(err instanceof AiAnswerError)) fail(err.message);
          throw err;
        } finally {
          busy--;
          rt.touch();
          publish();
        }
      },
    });
  }

  // A task on the AI in use. The AI and its provider are picked when the task
  // starts: one waiting in the queue during a switch runs on the new AI, and
  // one already running keeps the AI it started on. First, a llama-server
  // AI checks that its own model answers, not another AI's.
  function run<T>(
    priority: Priority,
    key: string | undefined,
    signal: AbortSignal | undefined,
    work: (signal: AbortSignal, ai: SavedAi, provider: AiProvider) => Promise<T>,
  ) {
    return queued(priority, key, signal, async (sig) => {
      const ai = opts.getConfig();
      const provider = providerOf(ai);
      const wrong = await modelProblem(ai, provider);
      if (wrong) throw new AiUnavailableError(wrong);
      return work(sig, ai, provider);
    });
  }

  // A switch to another AI. The old runtime stops if the new AI uses another
  // one, as with any change of runtime. Then the new AI's program starts at
  // once, if the app runs it: you switched, so a window it opens is expected.
  // Its problems go to the pill, never thrown.
  async function switchTo(ai: SavedAi): Promise<void> {
    // Switching again cancels a start in progress.
    switchStart?.abort();
    const controller = new AbortController();
    switchStart = controller;
    switches++;
    failure = null;
    const before = runtime;
    try {
      const rt = await useRuntime();
      if (controller.signal.aborted) return;
      const atOnce = startsAtOnce(ai);
      // Both AIs use the same runtime. Two llama-servers the app starts share
      // one, which restarts only if the program differs, so a ready one is
      // left alone. Otherwise it's stopped as if it changed: that cancels a
      // start in progress, and a server you run yourself is checked again.
      if (rt === before && (!atOnce || rt.state() !== 'ready')) {
        await rt.stop().catch((err: unknown) => opts.logger.warn({ err }, 'Stopping the AI runtime failed'));
        if (controller.signal.aborted) return;
      }
      if (!atOnce) return;
      await rt.ensureRunning(controller.signal);
      const wrong = await modelProblem(ai, providerOf(ai));
      if (wrong && !controller.signal.aborted) fail(wrong);
    } catch (err) {
      // A start that failed holds its sentence in the runtime's state. A cancelled one says nothing.
      if (!isAbort(err)) opts.logger.warn({ err }, 'Starting the AI after a switch failed');
    } finally {
      if (switchStart === controller) switchStart = null;
      publish();
    }
  }

  opts.bus.on('settings.changed', ({ keys }) => {
    // A new or removed key for the AI in use may fix its problem (a refused
    // key, no key): the pill stops showing it. The next task says if it's
    // still there. A key for another AI changes nothing here.
    if (keys.includes('aiKeys') && failure !== null && savedKey() !== failureKey) {
      failure = null;
      publish();
    }
    if (!keys.includes('ai')) return;
    const ai = opts.getConfig();
    const as = JSON.stringify(ai);
    // An edit to the AI in use: the runtime follows, but nothing starts. A
    // change to it (its model, its address) may fix its problem, so the pill
    // stops showing it until the next task. A save that left it as it was
    // (adding another AI, say) changes nothing.
    if (ai.id === inUse) {
      if (as !== inUseAs) failure = null;
      inUseAs = as;
      return void useRuntime().then(publish);
    }
    inUse = ai.id;
    inUseAs = as;
    void switchTo(ai);
  });

  // Test connection: what the AI lists, then a short answer sent the way
  // reading an ad is. seen keeps the model list for a failed result.
  async function testAi(ai: SavedAi, typed: string | undefined, signal: AbortSignal | undefined, seen: { models: string[] }): Promise<AiTestResult> {
    const preset = AI_PRESETS[ai.preset];
    const provider = providerOf(ai, typed);
    const health = await provider.health();
    const models = health.models;
    seen.models = models;
    // A cloud AI's model list is best effort (Z.ai and Qwen have none):
    // the test chat decides.
    if (!health.ok && preset.group !== 'cloud') throw new AiUnavailableError(health.detail ?? "The AI server didn't answer.");
    const wrong = wrongModelFile(ai, opts.getAll(), models);
    if (wrong) throw new AiUnavailableError(wrong);
    if (preset.needsModel && !ai.model.trim()) {
      const has = models.length > 0 ? `The server has: ${someOf(models)}.` : "The server didn't list any.";
      // A problem with the settings: for the AI in use, the pill shows it too.
      throw new AiUnavailableError(`Pick a model. ${has}`);
    }
    // Sent the way reading an ad is, so a setting that breaks reading
    // ads (say, a field the server refuses) breaks the test too.
    const task = ai.tasks.parse;
    const started = opts.now().getTime();
    await provider.chat(
      {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Reply with {"reply": "OK"}.' },
        ],
        model: task.model || ai.model || undefined,
        temperature: 0,
        maxTokens: 64,
        jsonSchema: {
          name: 'connection_test',
          schema: { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false },
        },
        thinking: task.thinking,
        thinkingEffort: task.thinkingEffort,
        extra: task.extra,
      },
      { signal },
    );
    const replyMs = Math.max(0, opts.now().getTime() - started);
    return { ok: true, detail: `Connected to ${preset.label}. It replied in ${replyMs} ms.`, models, replyMs };
  }

  const failedTest = (err: unknown, seen: { models: string[] }): AiTestResult => ({
    ok: false,
    detail: isAbort(err) ? 'The test was cancelled.' : (err as Error).message,
    models: seen.models,
    replyMs: null,
  });

  // The AI in use, as saved, when its turn comes. The pill shows the result.
  async function test(): Promise<AiTestResult> {
    const seen = { models: [] as string[] };
    try {
      return await queued('interactive', 'ai-test', undefined, (signal) => testAi(opts.getConfig(), undefined, signal, seen));
    } catch (err) {
      return failedTest(err, seen);
    }
  }

  // The AI in a form, with what you typed. The AI in use waits its turn, and
  // its program may start. Any other runs at once, and never starts or
  // stops a program. The pill follows only the saved settings, so a form's
  // test changes it only when the form is the AI in use exactly as saved,
  // with its saved key: then a good test clears a problem (a usage limit
  // that has passed, say), and the jobs waiting for the AI are read.
  async function check(req: AiCheckRequest): Promise<AiTestResult> {
    const seen = { models: [] as string[] };
    try {
      const inUse = opts.getConfig();
      if (req.ai.id === inUse.id) {
        const asSaved = req.key === undefined && JSON.stringify(req.ai) === JSON.stringify(inUse);
        return await queued('interactive', 'ai-test', undefined, (signal) => testAi(req.ai, req.key, signal, seen), { status: asSaved });
      }
      return await testAi(req.ai, req.key, undefined, seen);
    } catch (err) {
      return failedTest(err, seen);
    }
  }

  return {
    parseJob(adText, o = {}) {
      return run(o.priority ?? 'parse', undefined, o.signal, (signal, ai, provider) =>
        parseJobTask({ provider, prompt: prompts.parse, config: ai, adText, today: opts.now(), signal }),
      );
    },

    rateJob(input, o = {}) {
      return run(o.priority ?? 'interactive', o.key, o.signal, async (signal, ai, provider) => ({
        rating: await rateJobTask({ provider, prompt: prompts.rate, config: ai, input, signal }),
        model: identityOf(ai, 'rate'),
      }));
    },

    rateCard(input, o = {}) {
      return run(o.priority ?? 'list', o.key, o.signal, async (signal, ai, provider) => ({
        rating: await rateCardTask({ provider, prompt: prompts.card, config: ai, input, signal }),
        model: identityOf(ai, 'card'),
      }));
    },

    classifyEmail(input, o = {}) {
      return run(o.priority ?? 'background', undefined, o.signal, (signal, ai, provider) =>
        classifyEmailTask({ provider, prompt: prompts.email, config: ai, input, signal }),
      );
    },

    async *writeDocument(input, o = {}) {
      // The queue task writes chunks into a buffer; this generator hands them on.
      const controller = new AbortController();
      const cancel = () => controller.abort();
      if (o.signal?.aborted) cancel();
      o.signal?.addEventListener('abort', cancel, { once: true });
      const buffer: string[] = [];
      let wake: (() => void) | null = null;
      // Set by the queue task's callbacks, so it's an object TypeScript can't narrow away.
      const state = { ended: false, failed: null as { error: unknown } | null };
      const notify = () => {
        wake?.();
        wake = null;
      };
      const work = run('interactive', o.key, controller.signal, async (signal, ai, provider) => {
        const prompt = prompts[input.kind];
        for await (const text of writeDocumentTask({ provider, prompt, config: ai, input, signal })) {
          buffer.push(text);
          notify();
        }
      }).then(
        () => {
          state.ended = true;
          notify();
        },
        (error: unknown) => {
          state.failed = { error };
          state.ended = true;
          notify();
        },
      );
      try {
        for (;;) {
          if (controller.signal.aborted) {
            await work;
            throw state.failed?.error ?? new DOMException('The AI task was cancelled.', 'AbortError');
          }
          if (buffer.length > 0) yield buffer.shift()!;
          else if (state.ended) {
            if (state.failed) throw state.failed.error;
            return;
          } else await new Promise<void>((resolve) => (wake = resolve));
        }
      } finally {
        o.signal?.removeEventListener('abort', cancel);
        if (!state.ended) cancel();
        await work;
      }
    },

    status() {
      const ai = opts.getConfig();
      return { ...current(), id: ai.id, name: ai.name, preset: ai.preset, baseUrl: ai.baseUrl };
    },

    test,

    check,

    async models(req) {
      try {
        const health = await providerOf(req.ai, req.key).health();
        if (health.ok) return { ok: true, models: health.models, detail: null };
        return { ok: false, models: [], detail: health.detail ?? "The AI server didn't answer." };
      } catch (err) {
        return { ok: false, models: [], detail: (err as Error).message };
      }
    },

    modelIdentity: (task) => identityOf(opts.getConfig(), task),

    async stop() {
      switchStart?.abort();
      queue.cancelAll();
      await queue.onIdle();
      await (runtime ?? opts.runtime()).stop();
      failure = null;
      publish();
    },

    stopNow() {
      switchStart?.abort();
      queue.cancelAll();
      (runtime ?? opts.runtime()).stopNow();
    },

    onIdle: () => queue.onIdle(),
  };
}
