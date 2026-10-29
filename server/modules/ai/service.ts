// The ai module's logic: runs AI tasks one at a time through the queue, makes
// sure the AI program is running first, and keeps track of the AI's state for
// the header pill. It knows nothing about jobs: text in, typed results out.

import {
  AI_PRESETS,
  type AiSettings,
  type AiState,
  type AiStatus,
  type AiTestResult,
  type EmailClassification,
  type ParsedJob,
  type Rating,
} from '../../../shared/contracts/index.ts';
import type { Clock } from '../../core/config.ts';
import { AiAnswerError, AiUnavailableError } from '../../core/errors.ts';
import type { EventBus } from '../../core/events.ts';
import type { Logger } from '../../core/logger.ts';
import { loadPrompt, PROMPTS_DIR } from './prompts.ts';
import type { AiProvider } from './provider.ts';
import { createAiQueue, type Priority } from './queue.ts';
import type { ModelRuntime } from './runtime.ts';
import { classifyEmailTask, type ClassifyInput } from './tasks/classify-email.ts';
import { parseJobTask } from './tasks/parse-job.ts';
import { rateJobTask, type RateInput } from './tasks/rate-job.ts';
import { writeDocumentTask, type WriteInput } from './tasks/write-document.ts';

export type { ClassifyInput, Priority, RateInput, WriteInput };

export interface AiService {
  parseJob(adText: string, opts?: { signal?: AbortSignal; priority?: Priority }): Promise<ParsedJob>;
  rateJob(input: RateInput, opts?: { signal?: AbortSignal; key?: string; priority?: Priority }): Promise<Rating>;
  // A resume or cover letter, as it's written. It holds the AI until the
  // stream ends, is cancelled, or the reader stops early.
  writeDocument(input: WriteInput, opts?: { signal?: AbortSignal; key?: string }): AsyncIterable<string>;
  // What one email means. Background work, so anything you're waiting for goes first.
  classifyEmail(input: ClassifyInput, opts?: { signal?: AbortSignal; priority?: Priority }): Promise<EmailClassification>;
  status(): AiStatus;
  test(): Promise<AiTestResult>;
  stop(): Promise<void>;
  // At once, with no waiting: for a crash or the app exiting.
  stopNow(): void;
  onIdle(): Promise<void>;
}

export type AiOptions = {
  provider: AiProvider;
  runtime: () => ModelRuntime;
  getConfig: () => AiSettings;
  bus: EventBus;
  logger: Logger;
  now: Clock;
  promptsDir?: string;
};

const isAbort = (err: unknown): boolean => (err as Error)?.name === 'AbortError';

export function createAiService(opts: AiOptions): AiService {
  const queue = createAiQueue();
  const dir = opts.promptsDir ?? PROMPTS_DIR;
  const prompts = {
    parse: loadPrompt(dir, 'parse-job'),
    rate: loadPrompt(dir, 'rate-job'),
    resume: loadPrompt(dir, 'write-resume'),
    cover_letter: loadPrompt(dir, 'write-cover-letter'),
    email: loadPrompt(dir, 'classify-email'),
  };

  let busy = 0;
  // Set when the server failed during a task, cleared by the next good one.
  let failure: string | null = null;
  let runtime: ModelRuntime | null = null;
  let unsubscribe: (() => void) | null = null;
  let last: { state: AiState; detail: string | null } = { state: 'off', detail: null };

  function current(): { state: AiState; detail: string | null } {
    if (busy > 0) return { state: 'busy', detail: null };
    if (failure) return { state: 'error', detail: failure };
    const rt = runtime ?? opts.runtime();
    const state = rt.state();
    return { state, detail: state === 'error' ? rt.detail() : null };
  }

  function publish(): void {
    const next = current();
    if (next.state === last.state && next.detail === last.detail) return;
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

  function run<T>(priority: Priority, key: string | undefined, signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>) {
    return queue.run({
      priority,
      key,
      signal,
      work: async (sig) => {
        const rt = await useRuntime();
        try {
          await rt.ensureRunning(sig, { background: priority === 'background' });
        } catch (err) {
          publish();
          throw err;
        }
        busy++;
        publish();
        try {
          const value = await work(sig);
          failure = null;
          return value;
        } catch (err) {
          if (err instanceof AiUnavailableError && !(err instanceof AiAnswerError)) failure = err.message;
          throw err;
        } finally {
          busy--;
          rt.touch();
          publish();
        }
      },
    });
  }

  opts.bus.on('settings.changed', ({ keys }) => {
    if (keys.includes('ai')) void useRuntime();
  });

  return {
    parseJob(adText, o = {}) {
      return run(o.priority ?? 'parse', undefined, o.signal, (signal) =>
        parseJobTask({ provider: opts.provider, prompt: prompts.parse, config: opts.getConfig(), adText, today: opts.now(), signal }),
      );
    },

    rateJob(input, o = {}) {
      return run(o.priority ?? 'interactive', o.key, o.signal, (signal) =>
        rateJobTask({ provider: opts.provider, prompt: prompts.rate, config: opts.getConfig(), input, signal }),
      );
    },

    classifyEmail(input, o = {}) {
      return run(o.priority ?? 'background', undefined, o.signal, (signal) =>
        classifyEmailTask({ provider: opts.provider, prompt: prompts.email, config: opts.getConfig(), input, signal }),
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
      const work = run('interactive', o.key, controller.signal, async (signal) => {
        const prompt = prompts[input.kind];
        for await (const text of writeDocumentTask({ provider: opts.provider, prompt, config: opts.getConfig(), input, signal })) {
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
      const config = opts.getConfig();
      return { ...current(), preset: config.preset, baseUrl: config.baseUrl };
    },

    async test() {
      const config = opts.getConfig();
      const preset = AI_PRESETS[config.preset];
      let models: string[] = [];
      try {
        return await run('interactive', 'ai-test', undefined, async (signal) => {
          const health = await opts.provider.health();
          models = health.models;
          if (!health.ok) throw new AiUnavailableError(health.detail ?? "The AI server didn't answer.");
          if (preset.needsModel && !config.model.trim()) {
            const has = models.length > 0 ? `The server has: ${models.join(', ')}.` : "The server didn't list any.";
            // A problem with the settings: the pill shows it too.
            throw new AiUnavailableError(`Pick a model. ${has}`);
          }
          // Sent the way reading an ad is, so a setting that breaks reading
          // ads (say, a field the server refuses) breaks the test too.
          const task = config.tasks.parse;
          const started = opts.now().getTime();
          await opts.provider.chat(
            {
              messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'Reply with {"reply": "OK"}.' },
              ],
              model: task.model || config.model || undefined,
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
        });
      } catch (err) {
        return { ok: false, detail: isAbort(err) ? 'The test was cancelled.' : (err as Error).message, models, replyMs: null };
      }
    },

    async stop() {
      queue.cancelAll();
      await queue.onIdle();
      await (runtime ?? opts.runtime()).stop();
      failure = null;
      publish();
    },

    stopNow() {
      queue.cancelAll();
      (runtime ?? opts.runtime()).stopNow();
    },

    onIdle: () => queue.onIdle(),
  };
}
