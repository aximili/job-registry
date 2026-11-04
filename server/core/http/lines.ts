// A task's reply as lines of JSON (NDJSON), for the AI's writing tasks: a
// brief, a prep plan and a draft each send their lines as they go, then end
// with done, or an error line with a sentence to show.

import { Readable } from 'node:stream';
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ReplacedError } from '../errors.ts';

// An AI can think for minutes and send nothing, and Firefox gives up on a
// reply that stays quiet too long (it did on Check now in Phase 5). So a
// reply with nothing to send says it's still there this often.
export const HEARTBEAT_MS = 20_000;

type ErrorLine = { kind: 'error'; message: string };
type AliveLine = { kind: 'alive' };

export type LineOptions = {
  // The sentence for a mistake in the code. Its own message is only logged.
  failed: string;
  // What the log says about that mistake.
  what: string;
  // The sentence when a newer task for the same thing took this one's place.
  replaced: string;
  heartbeatMs?: number;
};

const isAbort = (err: unknown): boolean => (err as Error)?.name === 'AbortError';

// The lines start sends, then an error line with a sentence if it fails.
// start runs at once, so a refusal before the first line (a missing job) is
// still a plain HTTP error. A reader that went away gets nothing more.
function lineStream<L extends { kind: string }>(
  start: (push: (line: L) => void) => Promise<unknown>,
  controller: AbortController,
  o: LineOptions & { log: FastifyBaseLogger },
): AsyncIterable<string> {
  const queue: (L | ErrorLine | AliveLine)[] = [];
  let ended = false;
  // The reader went away: nothing more is sent.
  let gone = false;
  let wake: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const quiet = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  // Each line puts the next "alive" off.
  const beat = () => {
    quiet();
    if (!ended && !gone) timer = setTimeout(() => push({ kind: 'alive' }), o.heartbeatMs ?? HEARTBEAT_MS);
  };
  const push = (line: L | ErrorLine | AliveLine) => {
    queue.push(line);
    beat();
    notify();
  };
  const end = () => {
    ended = true;
    quiet();
    notify();
  };
  let started: Promise<unknown>;
  try {
    started = start(push);
  } catch (err) {
    quiet();
    throw err;
  }
  started.then(end, (err: unknown) => {
    if (!isAbort(err)) {
      if (!(err instanceof AppError)) o.log.error({ err }, o.what);
      queue.push({ kind: 'error', message: err instanceof AppError ? err.message : o.failed });
    } else if (err instanceof ReplacedError && !controller.signal.aborted) {
      // A newer one for the same thing, while this reply is still read.
      queue.push({ kind: 'error', message: o.replaced });
    }
    end();
  });
  beat();
  return (async function* () {
    try {
      for (;;) {
        if (queue.length > 0) yield `${JSON.stringify(queue.shift())}\n`;
        else if (ended) return;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      // A reader that leaves early stops the task.
      gone = true;
      quiet();
      if (!ended) controller.abort();
    }
  })();
}

// A task's lines as the reply. Cancel, or closing the page, ends the
// request, which stops the AI.
export function sendLines<L extends { kind: string }>(
  req: FastifyRequest,
  reply: FastifyReply,
  start: (signal: AbortSignal, push: (line: L) => void) => Promise<unknown>,
  o: LineOptions,
): FastifyReply {
  const controller = new AbortController();
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  const stream = lineStream<L>((push) => start(controller.signal, push), controller, { log: req.log, ...o });
  return reply
    .type('application/x-ndjson; charset=utf-8')
    .header('cache-control', 'no-cache')
    .send(Readable.from(stream, { objectMode: false }));
}
