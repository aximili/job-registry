import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { WriterBrief } from '../../../shared/contracts/index.ts';
import { defaultReply, FakeAiProvider } from '../../../tests/fakes/fake-ai-provider.ts';
import { FakeRuntime } from '../../../tests/fakes/fake-runtime.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';
import { ValidationError } from '../../core/errors.ts';
import type { AiService, ChatRequest, WriteInput } from './index.ts';

const RESUME = '# Sam Taylor\n\nsam@example.com\n\n## Experience\n\n- Moved the web app to TypeScript.';

const INPUT: WriteInput = {
  kind: 'resume',
  profile: '# Sam Taylor\nSenior engineer. Moved the web app to TypeScript.',
  guide: 'Two pages at most.',
  job: 'Role: Senior Engineer\nCompany: Atlassian',
  ad: 'We want someone who knows TypeScript.',
  today: '28 October 2026',
  notes: [],
  brief: null,
};

function writer(text = RESUME) {
  return new FakeAiProvider((req) => (req.jsonSchema ? defaultReply(req) : text));
}

let app: TestApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('writeDocument', () => {
  it("streams the document's text, and never the model's thinking", async () => {
    const provider = writer();
    provider.thinking = 'Let me think about what Sam has done.';
    app = await createTestApp({ fakes: { ai: provider } });
    const chunks = await collect(app.services.ai.writeDocument(INPUT));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(RESUME);
    expect(chunks.join('')).not.toContain('think');
  });

  it('thinks first, with no limit, and puts the profile in the system part, and the guide, the job and the ad in the user part', async () => {
    const provider = writer();
    app = await createTestApp({ fakes: { ai: provider } });
    await collect(app.services.ai.writeDocument(INPUT));
    const req = provider.callsFor('write')[0]!;
    expect(req).toMatchObject({ thinking: true, thinkingEffort: 'max', maxTokens: 8192, temperature: 0.6 });
    expect(req.jsonSchema).toBeUndefined();
    const [system, user] = req.messages;
    expect(system!.role).toBe('system');
    expect(system!.content).toContain('Moved the web app to TypeScript.');
    expect(system!.content).toContain('Never invent');
    expect(system!.content).not.toContain('Two pages at most.');
    expect(user!.content).toContain('Two pages at most.');
    expect(user!.content).toContain('Company: Atlassian');
    expect(user!.content).toContain('We want someone who knows TypeScript.');
    expect(user!.content).not.toContain('Moved the web app');
  });

  it('a cover letter uses its own prompt, dated today', async () => {
    const provider = writer('Dear Hiring Manager,');
    app = await createTestApp({ fakes: { ai: provider } });
    await collect(app.services.ai.writeDocument({ ...INPUT, kind: 'cover_letter', guide: null }));
    const [system, user] = provider.callsFor('write')[0]!.messages;
    expect(user!.content.split('\n')[0]).toMatch(/cover letter/i);
    expect(user!.content).toContain('No guide given.');
    expect(user!.content).toContain('28 October 2026');
  });

  it('cancelling part-way stops the work and frees the AI for the next task', async () => {
    const provider = writer();
    provider.chunkDelayMs = 40;
    app = await createTestApp({ fakes: { ai: provider } });
    const controller = new AbortController();
    const chunks: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of app!.services.ai.writeDocument(INPUT, { signal: controller.signal })) {
          chunks.push(chunk);
          controller.abort();
        }
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(chunks).toHaveLength(1);
    await app.services.ai.onIdle();
    expect(provider.finished).toEqual([]);
    expect(app.services.ai.status().state).not.toBe('busy');
  });

  it('stopping early (leaving the loop) frees the AI too', async () => {
    const provider = writer();
    provider.chunkDelayMs = 40;
    app = await createTestApp({ fakes: { ai: provider } });
    for await (const _chunk of app.services.ai.writeDocument(INPUT)) break;
    await app.services.ai.onIdle();
    expect(provider.finished).toEqual([]);
  });

  it('holds the AI while it writes: a job ad waiting to be read goes after it', async () => {
    const provider = writer();
    provider.chunkDelayMs = 20;
    app = await createTestApp({ fakes: { ai: provider } });
    const stream = app.services.ai.writeDocument(INPUT)[Symbol.asyncIterator]();
    await stream.next();
    const parsed = app.services.ai.parseJob('An ad.');
    while (!(await stream.next()).done) {
      // keep reading
    }
    await parsed;
    expect(provider.finished.map((c) => c.jsonSchema?.name ?? 'write')).toEqual(['write', 'parsed_job']);
  });

  it("an AI that can't be reached throws from the stream", async () => {
    app = await createTestApp({ fakes: { ai: new FakeAiProvider(() => new Error("Can't reach the AI.")) } });
    await expect(collect(app.services.ai.writeDocument(INPUT))).rejects.toThrow("Can't reach the AI.");
    expect(app.services.ai.status().state).not.toBe('busy');
  });
});

describe('writeDocument with the notes and the brief', () => {
  const PLAN: WriterBrief = {
    contact: { name: 'Alex', email: 'alex@example-recruit.com.au', recruiter: true, organisation: 'Example Recruit' },
    opening: { quote: 'We build tools for builders.', why: 'I build tools for engineers.' },
    needs: [{ need: 'TypeScript', story: { title: 'The move', text: 'I moved the web app to TypeScript.' } }],
    gaps: [{ mustHave: 'Go', evidence: 'A side project.' }],
    answers: [{ question: 'Have you used Go?', answer: 'Yes, for a year.' }],
  };
  const NOTES = [{ at: '2026-11-03T12:00:00.000Z', text: 'Called Alex. Write to Alex, not the company.' }];

  it('a cover letter gets the notes and the whole brief in its user part', async () => {
    const provider = writer('Dear Alex,');
    app = await createTestApp({ fakes: { ai: provider } });
    await collect(app.services.ai.writeDocument({ ...INPUT, kind: 'cover_letter', notes: NOTES, brief: PLAN }));
    const [system, user] = provider.callsFor('write')[0]!.messages;
    expect(user!.content).toContain('3 Nov 2026: Called Alex. Write to Alex, not the company.');
    for (const line of ['Who to write to:', '- Name: Alex', '"We build tools for builders."', '  The move: I moved the web app to TypeScript.', '- Go: A side project.', '- Have you used Go? Yes, for a year.']) {
      expect(user!.content).toContain(line);
    }
    expect(system!.content).not.toContain('Called Alex');
    expect(system!.content).not.toContain('The move');
  });

  it("a resume gets the brief's needs, gaps and answers, but not the contact or the opening line", async () => {
    const provider = writer();
    app = await createTestApp({ fakes: { ai: provider } });
    await collect(app.services.ai.writeDocument({ ...INPUT, notes: NOTES, brief: PLAN }));
    const user = provider.callsFor('write')[0]!.messages[1]!.content;
    expect(user).toContain('  The move: I moved the web app to TypeScript.');
    expect(user).toContain('- Have you used Go? Yes, for a year.');
    expect(user).not.toContain('Who to write to');
    expect(user).not.toContain('We build tools for builders.');
  });

  it('with no notes and no brief, it says so', async () => {
    const provider = writer();
    app = await createTestApp({ fakes: { ai: provider } });
    await collect(app.services.ai.writeDocument(INPUT));
    const user = provider.callsFor('write')[0]!.messages[1]!.content;
    expect(user).toContain('No notes.');
    expect(user).toContain('No brief: plan it yourself, as my guide says.');
  });
});

// The worst case on Bonsai 2: a profile as long as the user's, every note
// and answer at its cap, a brief with every field at its cap, and a long ad.
describe('the budget (Review Focus 5)', () => {
  const STARTERS = fileURLToPath(new URL('../../../starters/profile/', import.meta.url));
  const GUIDES = {
    resume: readFileSync(join(STARTERS, 'resume-guide.md'), 'utf8'),
    cover_letter: readFileSync(join(STARTERS, 'cover-letter-guide.md'), 'utf8'),
  };
  const CUT = '\n[The rest of the ad was cut.]';
  const TODAY = '3 November 2026';
  // Made-up text of exactly n characters.
  const filler = (n: number) => 'Sam Taylor ran services at Example Co. '.repeat(Math.ceil(n / 38)).slice(0, n);
  // A profile of exactly n characters, with nothing to trim at either end.
  const profileOf = (n: number) => `# Sam Taylor\n\n${filler(n - 15)}.`;
  const NOTES = [1, 2, 3, 4, 5].map(() => ({ at: '2026-11-03T12:00:00.000Z', text: filler(400) }));
  const ANSWERS = [1, 2, 3, 4, 5].map(() => ({ question: filler(160), answer: filler(240) }));
  const story = () => ({ title: filler(80), text: filler(320) });
  const FULL: WriterBrief = {
    contact: { name: filler(120), email: filler(120), recruiter: true, organisation: filler(120) },
    opening: { quote: filler(300), why: filler(240) },
    needs: [1, 2, 3].map(() => ({ need: filler(160), story: story() })),
    gaps: [1, 2, 3, 4, 5].map(() => ({ mustHave: filler(160), evidence: filler(240) })),
    answers: ANSWERS,
  };
  const JOB = filler(3_000);
  // Numbered words, so where the ad was cut can be seen.
  const AD = Array.from({ length: 5_000 }, (_, i) => `w${i}`).join(' ').slice(0, 20_000).trim();

  const size = (req: ChatRequest) => req.messages.reduce((n, m) => n + m.content.length, 0);

  // Every writing task, once each, with a profile of this many characters.
  async function writeAll(ai: AiService, chars: number): Promise<void> {
    const profile = profileOf(chars);
    await ai.briefJob({ profile, job: JOB, ad: AD, notes: NOTES, answers: ANSWERS, today: TODAY });
    await ai.prepJob({ profile, job: JOB, ad: AD, notes: NOTES, brief: FULL, today: TODAY });
    for (const kind of ['resume', 'cover_letter'] as const) {
      await collect(ai.writeDocument({ kind, profile, guide: GUIDES[kind], job: JOB, ad: AD, today: TODAY, notes: NOTES, brief: FULL }));
    }
  }

  const resume = (chars: number): WriteInput => ({
    kind: 'resume',
    profile: profileOf(chars),
    guide: GUIDES.resume,
    job: JOB,
    ad: AD,
    today: TODAY,
    notes: NOTES,
    brief: FULL,
  });

  const CLAUDE = { ai: { active: 'claude-mine', saved: [{ id: 'claude-mine', name: 'Claude – mine', preset: 'anthropic', model: 'claude-sonnet-5-5' }] } } as const;

  it('on a local AI, with an 86,000-character profile, every writing request is 108,000 characters or fewer', async () => {
    const provider = writer();
    app = await createTestApp({ fakes: { ai: provider } });
    await writeAll(app.services.ai, 86_000);
    expect(provider.calls.map((c) => c.jsonSchema?.name ?? 'write')).toEqual(['brief', 'prep_plan', 'write', 'write']);
    for (const req of provider.calls) {
      expect(size(req)).toBeLessThanOrEqual(108_000);
      // The ad is still there, last, even when it's cut short.
      expect(req.messages[1]!.content).toMatch(/w0 w1 w2 [\s\S]*(w\d+|\[The rest of the ad was cut\.\])$/);
    }
  });

  it('on a cloud AI, the ad gets its 12,000 characters, whatever the profile', async () => {
    const provider = writer();
    app = await createTestApp({ fakes: { ai: provider }, settings: CLAUDE });
    await writeAll(app.services.ai, 86_000);
    expect(provider.calls).toHaveLength(4);
    for (const req of provider.calls) expect(req.messages[1]!.content.endsWith(`\n\n${AD.slice(0, 12_000)}${CUT}`)).toBe(true);
  });

  it('on a local AI, a request over 120,000 characters is refused before anything is sent, and never reaches the pill', async () => {
    const provider = writer();
    const runtime = new FakeRuntime();
    app = await createTestApp({ fakes: { ai: provider, runtime } });
    await app.services.ai.parseJob('An ad.');
    const before = app.services.ai.status();
    // About 121,000 characters with every cap full.
    const err = await collect(app.services.ai.writeDocument(resume(100_000))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(
      /^This is too long for Bonsai 2: about 12\d,000 characters, and it fits about 108,000\. Shorten your master profile or your guide, or pick a cloud AI to write \(Settings → AI\)\.$/,
    );
    expect(provider.callsFor('write')).toEqual([]);
    expect(runtime.background).toEqual([false]);
    expect(app.services.ai.status()).toEqual(before);
    // The brief and the prep plan too.
    const profile = profileOf(115_000);
    await expect(app.services.ai.briefJob({ profile, job: JOB, ad: AD, notes: NOTES, answers: ANSWERS, today: TODAY })).rejects.toThrow(/^This is too long/);
    await expect(app.services.ai.prepJob({ profile, job: JOB, ad: AD, notes: NOTES, brief: FULL, today: TODAY })).rejects.toThrow(/^This is too long/);
    expect(provider.calls.map((c) => c.jsonSchema?.name)).toEqual(['parsed_job']);
    expect(app.services.ai.status()).toEqual(before);
  });

  it('on a local AI, a request between 108,000 and 120,000 characters is still sent, with the ad at its floor, and one character more is refused', async () => {
    const provider = writer();
    app = await createTestApp({ fakes: { ai: provider } });
    await collect(app.services.ai.writeDocument(resume(95_000)));
    const req = provider.callsFor('write')[0]!;
    expect(size(req)).toBeGreaterThan(108_000);
    expect(size(req)).toBeLessThan(120_000);
    expect(req.messages[1]!.content.endsWith(`\n\n${AD.slice(0, 2_000)}${CUT}`)).toBe(true);
    // With the ad at its floor, each character more in the profile is one more in the request.
    const edge = 95_000 + (120_000 - size(req));
    await collect(app.services.ai.writeDocument(resume(edge)));
    expect(size(provider.callsFor('write')[1]!)).toBe(120_000);
    await expect(collect(app.services.ai.writeDocument(resume(edge + 1)))).rejects.toThrow(
      'This is too long for Bonsai 2: about 121,000 characters, and it fits about 108,000. Shorten your master profile or your guide, or pick a cloud AI to write (Settings → AI).',
    );
    expect(provider.callsFor('write')).toHaveLength(2);
  });

  it('on a cloud AI, nothing is refused for its length', async () => {
    const provider = writer();
    app = await createTestApp({ fakes: { ai: provider }, settings: CLAUDE });
    await collect(app.services.ai.writeDocument(resume(100_000)));
    await collect(app.services.ai.writeDocument(resume(95_000)));
    expect(provider.callsFor('write').map(size).every((n) => n > 108_000)).toBe(true);
  });
});
