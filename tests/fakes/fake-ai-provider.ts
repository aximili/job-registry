// A scripted AiProvider for tests. Each call asks `reply` what to answer:
// some text, or an Error to throw. It can be slow, it records every request,
// and it honours cancelling, like a real server.

import type { CardRating, EmailClassification, ParsedJob, Rating } from '../../shared/contracts/index.ts';
import type { AiProvider, ChatChunk, ChatRequest, ChatResult, ProviderHealth } from '../../server/modules/ai/provider.ts';

export type FakeReplyFn = (req: ChatRequest) => string | Error | Promise<string | Error>;

export const FAKE_PARSED: ParsedJob = {
  title: 'Senior Engineer',
  company: 'Atlassian',
  agency: null,
  location: 'Sydney NSW',
  workMode: 'hybrid',
  employmentType: 'full-time',
  salary: { min: 150000, max: 170000, currency: 'AUD', period: 'year', text: '$150,000 - $170,000' },
  closingDate: null,
  summary: 'Build developer tools.',
  requirements: ['TypeScript', '5 years of experience'],
  niceToHave: ['Go'],
  responsibilities: ['Ship features'],
  adContact: null,
};

export const FAKE_RATING: Rating = {
  verdict: 'good',
  score: 72,
  why: ['Matches your TypeScript experience'],
  whyNot: ['Asks for 5 years of Go'],
  dealBreakers: [],
  salaryNote: null,
};

// The quick rating the fake gives every job card in a search list.
export const FAKE_CARD_RATING: CardRating = { verdict: 'good', score: 68, reason: 'Your TypeScript work fits the role.' };

export const FAKE_CLASSIFICATION: EmailClassification = {
  event: 'rejected',
  jobId: null,
  company: 'Atlassian',
  role: 'Senior Engineer',
  confidence: 0.9,
  summary: 'They will not progress your application.',
};

// The default reply: a valid answer for whichever task is asking.
export const defaultReply: FakeReplyFn = (req) => {
  if (req.jsonSchema?.name === 'parsed_job') return JSON.stringify(FAKE_PARSED);
  if (req.jsonSchema?.name === 'rating') return JSON.stringify(FAKE_RATING);
  if (req.jsonSchema?.name === 'card_rating') return JSON.stringify(FAKE_CARD_RATING);
  if (req.jsonSchema?.name === 'email_classification') return JSON.stringify(FAKE_CLASSIFICATION);
  return 'OK';
};

export class FakeAiProvider implements AiProvider {
  calls: ChatRequest[] = [];
  // Calls that ran to the end (not cancelled part-way).
  finished: ChatRequest[] = [];
  down = false;
  delayMs: number;
  // The model's thinking, kept apart from the answer like a real server's.
  thinking = '';
  // A pause between streamed chunks, for cancelling part-way.
  chunkDelayMs = 0;
  reply: FakeReplyFn;

  constructor(reply: FakeReplyFn = defaultReply, opts: { delayMs?: number } = {}) {
    this.reply = reply;
    this.delayMs = opts.delayMs ?? 0;
  }

  async chat(req: ChatRequest, opts: { signal?: AbortSignal } = {}): Promise<ChatResult> {
    this.calls.push(req);
    await wait(this.delayMs, opts.signal);
    const answer = await this.reply(req);
    if (answer instanceof Error) throw answer;
    this.finished.push(req);
    return { text: answer, thinking: this.thinking };
  }

  // A stream counts as finished only when its last chunk has gone.
  async *chatStream(req: ChatRequest, opts: { signal?: AbortSignal } = {}): AsyncIterable<ChatChunk> {
    this.calls.push(req);
    await wait(this.delayMs, opts.signal);
    const answer = await this.reply(req);
    if (answer instanceof Error) throw answer;
    if (this.thinking) yield { kind: 'thinking', text: this.thinking };
    for (const word of answer.split(/(?<= )/)) {
      await wait(this.chunkDelayMs, opts.signal);
      yield { kind: 'text', text: word };
    }
    this.finished.push(req);
  }

  async health(): Promise<ProviderHealth> {
    return this.down
      ? { ok: false, models: [], detail: "Can't reach the AI at http://fake/v1. Check that it's running, or pick another AI in Settings." }
      : { ok: true, models: ['fake-model'], detail: null };
  }

  // Calls for one task only, by its schema name. Writing a document has no schema.
  callsFor(name: 'parsed_job' | 'rating' | 'card_rating' | 'email_classification' | 'write'): ChatRequest[] {
    return this.calls.filter((c) => (c.jsonSchema?.name ?? 'write') === name);
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

const abortError = () => new DOMException('The AI task was cancelled.', 'AbortError');
