// Reads each new ad with the AI after it's saved, then rates it. It works in
// the background, so saving never waits for the AI. It hands what the AI read
// to the jobs module, which decides what may be filled in. See §7.1.
//
// When the AI can't be reached, a job keeps waiting ("pending", with the
// reason), and it's read the next time an AI task works. A job is marked
// "failed", with the reason, when trying again later won't help on its own:
// the answer never fitted, or the server refused this ad or timed out on it.

import type { Job, Posting } from '../../../shared/contracts/index.ts';
import { AiAnswerError, AiRefusedError, AiUnavailableError, ValidationError } from '../../core/errors.ts';
import type { EventBus } from '../../core/events.ts';
import type { Logger } from '../../core/logger.ts';
import type { AiService, Priority } from '../ai/index.ts';
import type { JobsService } from '../jobs/index.ts';
import type { RatingsService } from '../ratings/index.ts';

export interface EnrichService {
  // "Parse again": reads the newest ad again and rates it afresh.
  reparse(jobId: number): Job;
  // Reads every job still waiting, one at a time, in the background.
  // Returns how many were waiting.
  sweep(): number;
  // Resolves when nothing it started is still running.
  onIdle(): Promise<void>;
}

type Outcome =
  | { kind: 'done' | 'cancelled' }
  // failed: a bad answer. refused: the server refused this ad or timed out.
  // unavailable: the AI can't be reached at all.
  | { kind: 'failed' | 'refused' | 'unavailable'; message: string };

const isAbort = (err: unknown): boolean => (err as Error)?.name === 'AbortError';

function classify(err: unknown): 'failed' | 'refused' | 'unavailable' {
  if (err instanceof AiAnswerError) return 'failed';
  if (err instanceof AiRefusedError) return 'refused';
  if (err instanceof AiUnavailableError) return 'unavailable';
  return 'failed';
}

export function createEnrichService(opts: {
  bus: EventBus;
  jobs: JobsService;
  ai: AiService;
  ratings: RatingsService;
  logger: Logger;
}): EnrichService {
  const { bus, jobs, ai, ratings, logger } = opts;
  const running = new Set<Promise<unknown>>();
  // Jobs being read right now, so a sweep never reads one twice.
  const busy = new Set<number>();
  let sweeping = false;

  function track<T>(work: Promise<T>): Promise<T> {
    running.add(work);
    void work.finally(() => running.delete(work)).catch(() => undefined);
    return work;
  }

  async function enrich(jobId: number, posting: Posting, priority: Priority, force: boolean): Promise<Outcome> {
    const job = jobs.get(jobId);
    if (job.parseState !== 'pending' || job.parseError) jobs.setParseState(jobId, 'pending');
    busy.add(jobId);
    try {
      try {
        const parsed = await ai.parseJob(posting.jdText, { priority });
        jobs.applyParsed(jobId, parsed);
        bus.emit('enrich.done', { jobId, step: 'parse' });
      } catch (err) {
        // Cancelled because the app is stopping: it stays "pending", and the
        // next start-up sweep reads it.
        if (isAbort(err)) return { kind: 'cancelled' };
        const message = (err as Error).message;
        const kind = classify(err);
        jobs.setParseState(jobId, kind === 'unavailable' ? 'pending' : 'failed', message);
        bus.emit('enrich.failed', { jobId, step: 'parse', error: message });
        return { kind, message };
      }
      try {
        const result = await ratings.rate(posting, { priority, force });
        if (result.rating) {
          jobs.setRating(jobId, result.rating);
          bus.emit('enrich.done', { jobId, step: 'rate' });
        }
      } catch (err) {
        if (isAbort(err)) return { kind: 'cancelled' };
        logger.warn({ jobId, err }, 'Rating a job failed');
        bus.emit('enrich.failed', { jobId, step: 'rate', error: (err as Error).message });
      }
      return { kind: 'done' };
    } finally {
      busy.delete(jobId);
    }
  }

  function start(jobId: number, posting: Posting, priority: Priority, force = false): void {
    void track(enrich(jobId, posting, priority, force)).catch((err: unknown) =>
      logger.error({ jobId, err }, 'Reading a job ad failed unexpectedly'),
    );
  }

  // The newest ad with any text in it.
  const newestAd = (jobId: number): Posting | undefined => jobs.listPostings(jobId).find((p) => p.jdText.trim() !== '');

  bus.on('posting.added', ({ jobId, postingId }) => {
    const posting = jobs.listPostings(jobId).find((p) => p.id === postingId);
    if (!posting || !posting.jdText.trim()) return;
    start(jobId, posting, 'parse');
  });

  // Every job still waiting in this round gets the same reason, so none of
  // them claims to be "reading" while nothing is.
  function stillWaiting(ids: number[], message: string): void {
    for (const jobId of ids) {
      if (busy.has(jobId)) continue;
      const job = jobs.get(jobId);
      if (job.parseState === 'pending' && job.parseError !== message) jobs.setParseState(jobId, 'pending', message);
    }
  }

  // One at a time, at background priority, so a job you save meanwhile goes
  // first. The first "can't reach the AI" ends the round, instead of each job
  // trying (and maybe starting llama-server) in turn. A refused ad is marked
  // failed and the round carries on; but two refusals in a row with the same
  // message mean the server refuses everything (a wrong model, say), so the
  // round stops and those jobs wait too.
  async function sweepRound(ids: number[]): Promise<void> {
    let lastRefused: { jobId: number; message: string } | null = null;
    try {
      for (const [i, jobId] of ids.entries()) {
        if (busy.has(jobId)) continue;
        const job = jobs.get(jobId);
        if (job.parseState !== 'pending' || job.archived) continue;
        const posting = newestAd(jobId);
        if (!posting) continue;
        const outcome = await enrich(jobId, posting, 'background', false);
        if (outcome.kind === 'cancelled') break;
        if (outcome.kind === 'unavailable') {
          stillWaiting(ids.slice(i + 1), outcome.message);
          break;
        }
        if (outcome.kind === 'refused') {
          if (lastRefused && lastRefused.message === outcome.message) {
            jobs.setParseState(lastRefused.jobId, 'pending', outcome.message);
            jobs.setParseState(jobId, 'pending', outcome.message);
            stillWaiting(ids.slice(i + 1), outcome.message);
            break;
          }
          lastRefused = { jobId, message: outcome.message };
          continue;
        }
        lastRefused = null;
      }
    } finally {
      sweeping = false;
    }
  }

  function sweep(): number {
    if (sweeping) return 0;
    const ids = jobs.listIdsByParseState('pending').filter((id) => !busy.has(id) && newestAd(id));
    if (ids.length === 0) return 0;
    sweeping = true;
    void track(sweepRound(ids)).catch((err: unknown) => logger.error({ err }, 'Reading waiting jobs failed'));
    return ids.length;
  }

  // A task just finished well ("busy" then "ready"), so the AI works: read
  // the jobs that were waiting for it. "ready" alone only means it started.
  let lastState = '';
  bus.on('ai.stateChanged', ({ state }) => {
    if (state === 'ready' && lastState === 'busy') sweep();
    lastState = state;
  });

  return {
    reparse(jobId) {
      jobs.get(jobId);
      const posting = newestAd(jobId);
      if (!posting) throw new ValidationError('This job has no ad text to read.');
      start(jobId, posting, 'parse', true);
      return jobs.get(jobId);
    },

    sweep,

    async onIdle() {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
  };
}
