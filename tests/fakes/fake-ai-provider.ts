// A scripted AiProvider for tests. Each call asks `reply` what to answer:
// some text, or an Error to throw. It can be slow, it records every request,
// and it honours cancelling, like a real server.

import type { BriefAnswer, CardRating, EmailClassification, ParsedJob, PrepAnswer, Rating } from '../../shared/contracts/index.ts';
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

// The brief and the prep plan the fake makes, from the browser tests' master
// profile (Sam Taylor, Example Co: E2E_PROFILE in smart-fake-ai.ts). Every
// text is within its cap, and nothing has a link, so neither is cut.
const MOVE = { title: 'Moving the web app to TypeScript', text: 'At Example Co, I moved the web app to TypeScript, after eight years of writing it.' };
const BUILDS = { title: 'Cutting build times by 30%', text: 'Builds at Example Co were slow. I cut build times by 30%.' };
const SENIOR = { title: 'Senior engineer at Example Co', text: 'From 2019 to 2024 I was a senior engineer at Example Co.' };

export const FAKE_BRIEF: BriefAnswer = {
  contact: { name: 'Alex', email: 'alex@example-recruit.com.au', recruiter: true, organisation: 'Example Recruit' },
  needs: [
    { need: 'Deep TypeScript experience', story: MOVE, others: [SENIOR, BUILDS] },
    { need: 'Faster builds and releases', story: BUILDS, others: [MOVE, SENIOR] },
    { need: 'A senior engineer who leads by example', story: SENIOR, others: [MOVE, BUILDS] },
  ],
  opening: { quote: "You'll help our engineers ship faster.", why: 'I cut build times by 30% at Example Co.' },
  gaps: [
    { mustHave: 'Go', evidence: "My profile doesn't show Go. My nearest is eight years of TypeScript." },
    { mustHave: 'Leading a team', evidence: 'As a senior engineer at Example Co, I moved the web app to TypeScript.' },
  ],
  questions: [
    { question: 'Have you used Go, even in a side project?', why: "The ad lists Go as a must-have, and your profile doesn't mention it." },
    { question: 'Can I name the Example Co web app in the letter?', why: 'Naming the product makes the story stronger.' },
    { question: 'How many people were on the team when you cut the build times?', why: "The ad asks about team size, and your profile doesn't say." },
  ],
};

export const FAKE_PREP: PrepAnswer = {
  learn: [
    {
      topic: 'Go basics',
      why: "The ad lists Go, and your profile doesn't show it yet.",
      steps: ['Read about Go types, errors and packages.', 'Rewrite a small TypeScript script of yours in Go.', "Write tests for it with Go's testing package."],
      hours: 4,
      afterwards: "I've learnt Go's basics and rewritten a small tool in it.",
    },
    {
      topic: 'Build caching in a pipeline',
      why: 'The ad values fast releases, and you cut build times by 30% at Example Co.',
      steps: ['List the slowest steps in a sample pipeline.', 'Cache the dependencies and the build output.', 'Measure the time before and after.'],
      hours: 2,
      afterwards: 'I can explain how I would speed up a pipeline with caching.',
    },
    {
      topic: 'Testing a TypeScript service',
      why: 'The ad asks for well-tested code.',
      steps: ['Add unit tests to a small service.', 'Add one end-to-end test.', 'Run them on each push.'],
      hours: 3,
      afterwards: 'I can talk through how I test a TypeScript service, with an example.',
    },
  ],
  project: {
    title: 'A build-time dashboard',
    what: 'A small TypeScript app that reads build logs and shows how long each step takes, with a Go helper that parses the logs.',
    touches: ['Go', 'TypeScript', 'Build pipelines'],
    hours: 6,
    afterwards: 'I built a small tool in TypeScript and Go that shows where build time goes.',
  },
  interview: [
    { question: 'Tell us about a time you made developers faster.', story: 'Cutting build times by 30% at Example Co.' },
    { question: 'How would you move a large codebase to TypeScript?', story: 'Moving the Example Co web app to TypeScript.' },
    { question: 'Why this role, after Example Co?', story: 'Eight years of TypeScript, and wanting to keep building tools for engineers.' },
    { question: 'We use Go for some services. How would you get up to speed?', story: 'The Go basics you learnt, and the build-time dashboard.' },
  ],
  ask: [
    { question: 'What does a typical week look like for this team?', why: "The ad doesn't say how the team works day to day." },
    { question: 'Which services use Go, and which TypeScript?', why: 'The ad lists both, but not where each is used.' },
    { question: 'How will you measure success in the first six months?', why: 'The ad leaves the goals of the role open.' },
  ],
  refresh: [
    { item: 'How you measured the 30% cut in build times', why: "They'll likely ask how you know." },
    { item: 'Your dates at Example Co (2019 to 2024)', why: 'The ad asks for five years of experience.' },
  ],
};

// The default reply: a valid answer for whichever task is asking.
export const defaultReply: FakeReplyFn = (req) => {
  if (req.jsonSchema?.name === 'parsed_job') return JSON.stringify(FAKE_PARSED);
  if (req.jsonSchema?.name === 'rating') return JSON.stringify(FAKE_RATING);
  if (req.jsonSchema?.name === 'card_rating') return JSON.stringify(FAKE_CARD_RATING);
  if (req.jsonSchema?.name === 'email_classification') return JSON.stringify(FAKE_CLASSIFICATION);
  if (req.jsonSchema?.name === 'brief') return JSON.stringify(FAKE_BRIEF);
  if (req.jsonSchema?.name === 'prep_plan') return JSON.stringify(FAKE_PREP);
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
  // Set part-way through a stream: the server went away, so it stops with this.
  cut: Error | null = null;
  // What health() lists: llama-server lists the model file it runs.
  models = ['fake-model'];
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
      if (this.cut) throw this.cut;
      yield { kind: 'text', text: word };
    }
    this.finished.push(req);
  }

  async health(): Promise<ProviderHealth> {
    return this.down
      ? { ok: false, models: [], detail: "Can't reach the AI at http://fake/v1. Check that it's running, or pick another AI in Settings." }
      : { ok: true, models: [...this.models], detail: null };
  }

  // Calls for one task only, by its schema name. Writing a document has no schema.
  callsFor(name: 'parsed_job' | 'rating' | 'card_rating' | 'email_classification' | 'brief' | 'prep_plan' | 'write'): ChatRequest[] {
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
