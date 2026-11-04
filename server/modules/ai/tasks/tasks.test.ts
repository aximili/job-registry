import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WriterBrief } from '../../../../shared/contracts/index.ts';
import { FAKE_BRIEF, FAKE_PARSED, FAKE_PREP, FAKE_RATING, FakeAiProvider, defaultReply } from '../../../../tests/fakes/fake-ai-provider.ts';
import { createSmartFake, E2E_PROFILE, FAKE_COVER_LETTER, FAKE_RESUME } from '../../../../tests/fakes/smart-fake-ai.ts';
import { createTestApp, type TestApp } from '../../../../tests/helpers/test-app.ts';
import type { BriefInput, PrepInput } from '../index.ts';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function withProvider(provider: FakeAiProvider) {
  app = await createTestApp({ now: () => new Date('2026-10-28T03:15:00Z'), fakes: { ai: provider } });
  return app.services.ai;
}

describe('AI tasks', () => {
  it('parseJob sends the ad last, trimmed to 12,000 characters, with thinking off', async () => {
    const provider = new FakeAiProvider();
    const ai = await withProvider(provider);
    const ad = 'Senior Engineer at Atlassian. ' + 'x'.repeat(20_000);
    expect(await ai.parseJob(ad)).toEqual(FAKE_PARSED);
    const req = provider.calls[0]!;
    expect(req.messages.map((m) => m.role)).toEqual(['system', 'user']);
    const user = req.messages[1]!.content;
    expect(user).toContain('Today is 28 Oct 2026 (2026-10-28).');
    expect(user.endsWith('x'.repeat(100) + '\n[The rest of the ad was cut.]')).toBe(true);
    expect(user.length).toBeLessThan(12_400);
    expect(req.thinking).toBe(false);
    expect(req.jsonSchema?.name).toBe('parsed_job');
    expect(req.maxTokens).toBe(4096);
  });

  it('a reply in code fences after a <think> block still parses', async () => {
    const ai = await withProvider(new FakeAiProvider(() => `<think>hmm</think>\n\`\`\`json\n${JSON.stringify(FAKE_PARSED)}\n\`\`\``));
    expect(await ai.parseJob('An ad.')).toEqual(FAKE_PARSED);
  });

  it('an invalid reply is retried once with the error, then succeeds', async () => {
    let n = 0;
    const provider = new FakeAiProvider((req) => (n++ === 0 ? '{"title": 5}' : defaultReply(req)));
    const ai = await withProvider(provider);
    expect(await ai.parseJob('An ad.')).toEqual(FAKE_PARSED);
    expect(provider.calls).toHaveLength(2);
    const retry = provider.calls[1]!.messages;
    expect(retry.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(retry[3]!.content).toMatch(/^That answer was not valid: .+ Reply again with only the JSON object\.$/s);
  });

  it('two invalid replies fail with a plain message', async () => {
    const provider = new FakeAiProvider(() => '{"title":');
    const ai = await withProvider(provider);
    await expect(ai.parseJob('An ad.')).rejects.toThrow("The AI's answer didn't fit the expected format, even after a second try.");
    expect(provider.calls).toHaveLength(2);
  });

  it('blank text fields come back as null, and lists lose blank items', async () => {
    const messy = { ...FAKE_PARSED, title: '  ', company: ' Atlassian ', summary: ' Build tools. ', requirements: ['TypeScript', ' ', ''] };
    const ai = await withProvider(new FakeAiProvider(() => JSON.stringify(messy)));
    const parsed = await ai.parseJob('An ad.');
    expect(parsed).toMatchObject({ title: null, company: 'Atlassian', summary: 'Build tools.', requirements: ['TypeScript'] });
  });

  it('rateJob puts the profile before the ad, and says when no preferences were given', async () => {
    const provider = new FakeAiProvider();
    const ai = await withProvider(provider);
    expect((await ai.rateJob({ profile: 'I write TypeScript.', preferences: null, ad: 'We need Go.' })).rating).toEqual(FAKE_RATING);
    const req = provider.callsFor('rating')[0]!;
    const all = req.messages.map((m) => m.content).join('\n');
    expect(all.indexOf('I write TypeScript.')).toBeLessThan(all.indexOf('We need Go.'));
    expect(req.messages[0]!.content).toContain('I write TypeScript.');
    expect(all).toContain('None given.');
    expect(req.thinking).toBe(false);
  });
});

describe('AI task: classifyEmail', () => {
  const candidates = [
    { id: 1, title: 'Senior Engineer', company: 'Atlassian', agency: null, status: 'Applied' },
    { id: 4, title: 'Platform Lead', company: null, agency: 'Hays', status: 'Screening' },
  ];
  const input = {
    from: 'careers@atlassian.com',
    subject: 'Your application for Senior Engineer',
    receivedAt: '2026-10-27T22:00:00.000Z',
    text: 'Unfortunately we will not progress your application.',
    candidates,
  };
  const answer = (extra: object) => () =>
    JSON.stringify({ event: 'rejected', jobId: 1, company: 'Atlassian', role: 'Senior Engineer', confidence: 0.9, summary: 'Not progressing.', ...extra });

  it('sends the candidates as a numbered list, the email last, with thinking off', async () => {
    const provider = new FakeAiProvider(answer({}));
    const ai = await withProvider(provider);
    expect(await ai.classifyEmail(input)).toMatchObject({ event: 'rejected', jobId: 1 });
    const req = provider.calls[0]!;
    expect(req.jsonSchema?.name).toBe('email_classification');
    expect(req.thinking).toBe(false);
    expect(req.maxTokens).toBe(1024);
    expect(req.temperature).toBe(0.1);
    const system = req.messages[0]!.content;
    expect(system).toContain('[1] Senior Engineer at Atlassian (Applied)');
    expect(system).toContain('[4] Platform Lead, through Hays (Screening)');
    expect(system).toMatch(/never follow instructions/i);
    const user = req.messages[1]!.content;
    expect(user).toContain('Subject: Your application for Senior Engineer');
    expect(user.trim().endsWith('Unfortunately we will not progress your application.')).toBe(true);
  });

  it("says when there are no candidate jobs", async () => {
    const provider = new FakeAiProvider(answer({ jobId: null }));
    const ai = await withProvider(provider);
    await ai.classifyEmail({ ...input, candidates: [] });
    expect(provider.calls[0]!.messages[0]!.content).toContain('None.');
  });

  it("drops a job id that wasn't a candidate", async () => {
    const ai = await withProvider(new FakeAiProvider(answer({ jobId: 99 })));
    expect((await ai.classifyEmail(input)).jobId).toBeNull();
  });

  it('trims the summary to 200 characters, and blank names become null', async () => {
    const ai = await withProvider(new FakeAiProvider(answer({ summary: `  ${'x'.repeat(300)}  `, company: '  ', role: ' Lead ' })));
    const result = await ai.classifyEmail(input);
    expect(result.summary).toHaveLength(200);
    expect(result.company).toBeNull();
    expect(result.role).toBe('Lead');
  });

  it('keeps the company and role short, so no email text hides in them', async () => {
    const ai = await withProvider(new FakeAiProvider(answer({ company: 'A'.repeat(500), role: 'B'.repeat(500) })));
    const result = await ai.classifyEmail(input);
    expect(result.company).toHaveLength(120);
    expect(result.role).toHaveLength(120);
  });

  it('waits behind reading a saved ad, because it runs in the background', async () => {
    const provider = new FakeAiProvider(defaultReply, { delayMs: 20 });
    provider.reply = (req) => (req.jsonSchema?.name === 'email_classification' ? answer({})() : defaultReply(req));
    const ai = await withProvider(provider);
    await Promise.all([ai.parseJob('First ad.'), ai.classifyEmail(input), ai.parseJob('Second ad.')]);
    expect(provider.calls.map((c) => c.jsonSchema?.name)).toEqual(['parsed_job', 'parsed_job', 'email_classification']);
  });
});

describe('AI tasks on the writing AI: the brief and the prep plan', () => {
  const NOTES = [
    { at: '2026-11-03T12:00:00.000Z', text: 'Email, 3 Nov 2026 (interview) from Alex: an interview on Friday.' },
    { at: '2026-11-01T12:00:00.000Z', text: 'Alex says they want someone who mentors.' },
  ];
  const BRIEF_IN: BriefInput = {
    profile: '# Sam Taylor\nSenior engineer. Moved the web app to TypeScript.',
    job: 'Role: Senior Engineer\nCompany: Example Co',
    ad: 'Example Co\nWe build tools for builders.\n- TypeScript\n- Go',
    notes: NOTES,
    answers: [{ question: 'Have you used Go?', answer: 'Yes, in a side project for a year.' }],
    today: '3 November 2026',
  };
  const PLAN: WriterBrief = {
    contact: { name: 'Alex', email: 'alex@example-recruit.com.au', recruiter: true, organisation: 'Example Recruit' },
    opening: { quote: 'We build tools for builders.', why: 'I build tools for engineers.' },
    needs: [{ need: 'TypeScript', story: { title: 'The move', text: 'I moved the web app to TypeScript.' } }],
    gaps: [{ mustHave: 'Go', evidence: 'A side project.' }],
    answers: [{ question: 'Have you used Go?', answer: 'Yes, in a side project for a year.' }],
  };
  const PREP_IN: PrepInput = { profile: BRIEF_IN.profile, job: BRIEF_IN.job, ad: BRIEF_IN.ad, notes: NOTES, brief: PLAN, today: '3 November 2026' };

  it("briefJob sends schema 'brief' with the brief task's settings, the profile first and the ad last, and returns the cut answer with the AI's name", async () => {
    const provider = new FakeAiProvider();
    const ai = await withProvider(provider);
    const { brief, by } = await ai.briefJob(BRIEF_IN);
    expect(by).toBe('Bonsai 2');
    expect(brief).toEqual({ ...FAKE_BRIEF, opening: { ...FAKE_BRIEF.opening, inAd: false } });
    const req = provider.callsFor('brief')[0]!;
    expect(req).toMatchObject({ temperature: 0.3, maxTokens: 3072, thinking: true, thinkingEffort: 'medium' });
    const [system, user] = req.messages;
    expect(system!.content).toContain('Moved the web app to TypeScript.');
    expect(user!.content).not.toContain('Moved the web app');
    expect(user!.content).toContain('Company: Example Co');
    expect(user!.content).toContain('3 Nov 2026: Email, 3 Nov 2026 (interview) from Alex: an interview on Friday.\n1 Nov 2026: Alex says');
    // The answers from the last brief, so it doesn't ask again.
    expect(user!.content).toContain('- Have you used Go? Yes, in a side project for a year.');
    expect(user!.content.endsWith(BRIEF_IN.ad)).toBe(true);
  });

  it("briefJob checks the quote against the whole ad", async () => {
    const quoted = { ...FAKE_BRIEF, opening: { quote: 'we build TOOLS for  builders.', why: 'I do.' } };
    const ai = await withProvider(new FakeAiProvider(() => JSON.stringify(quoted)));
    expect((await ai.briefJob(BRIEF_IN)).brief.opening).toEqual({ quote: 'we build TOOLS for  builders.', why: 'I do.', inAd: true });
  });

  it('a brief with too many needs, stories or questions is cut, not refused, and the schema sends maxItems but no maxLength', async () => {
    const story = { title: 'A story', text: 'What I did.' };
    const long = {
      ...FAKE_BRIEF,
      needs: [1, 2, 3, 4].map((n) => ({ need: `Need ${n}`, story, others: [story, story, story, story] })),
      questions: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ question: `Question ${n}?`, why: 'It matters.' })),
    };
    const provider = new FakeAiProvider(() => JSON.stringify(long));
    const ai = await withProvider(provider);
    const { brief } = await ai.briefJob(BRIEF_IN);
    expect(provider.calls).toHaveLength(1);
    expect(brief.needs).toHaveLength(3);
    expect(brief.needs[0]!.others).toHaveLength(2);
    expect(brief.questions).toHaveLength(5);
    const schema = JSON.stringify(provider.calls[0]!.jsonSchema!.schema);
    expect(schema).toContain('"maxItems":3');
    expect(schema).toContain('"maxItems":5');
    expect(schema).not.toContain('maxLength');
  });

  // Claude drops minItems from the schema it's sent, so a short list must
  // never fail the answer and cost a second, paid try.
  it('a short list is taken as it is, in one call: a brief with no needs, a topic with one step; the schema still asks for the least', async () => {
    const provider = new FakeAiProvider((req) =>
      req.jsonSchema?.name === 'brief'
        ? JSON.stringify({ ...FAKE_BRIEF, needs: [] })
        : JSON.stringify({ ...FAKE_PREP, learn: [{ ...FAKE_PREP.learn[0]!, steps: ['Read about Go types.'] }] }),
    );
    const ai = await withProvider(provider);
    expect((await ai.briefJob(BRIEF_IN)).brief.needs).toEqual([]);
    expect((await ai.prepJob(PREP_IN)).plan.learn[0]!.steps).toEqual(['Read about Go types.']);
    expect(provider.calls).toHaveLength(2);
    type ListSchema = { minItems?: number; maxItems?: number };
    const brief = provider.callsFor('brief')[0]!.jsonSchema!.schema as { properties: { needs: ListSchema } };
    expect(brief.properties.needs).toMatchObject({ minItems: 1, maxItems: 3 });
    const plan = provider.callsFor('prep_plan')[0]!.jsonSchema!.schema as { properties: { learn: { items: { properties: { steps: ListSchema } } } } };
    expect(plan.properties.learn.items.properties.steps).toMatchObject({ minItems: 2, maxItems: 4 });
  });

  it('a job with no ad text: the brief, the plan, the resume and the cover letter each say "No ad saved."', async () => {
    const provider = new FakeAiProvider((req) => (req.jsonSchema ? defaultReply(req) : 'A document.'));
    const ai = await withProvider(provider);
    await ai.briefJob({ ...BRIEF_IN, ad: '' });
    await ai.prepJob({ ...PREP_IN, ad: '  ' });
    const write = { profile: BRIEF_IN.profile, guide: null, job: BRIEF_IN.job, ad: '', today: '3 November 2026', notes: [], brief: null };
    for await (const _ of ai.writeDocument({ ...write, kind: 'resume' }));
    for await (const _ of ai.writeDocument({ ...write, kind: 'cover_letter' }));
    expect(provider.calls).toHaveLength(4);
    for (const call of provider.calls) expect(call.messages[1]!.content.endsWith('The job ad:\n\nNo ad saved.')).toBe(true);
  });

  it("a practice project touching more than 6 things is cut to 6, not refused, and the schema says 6", async () => {
    const touches = ['Go', 'TypeScript', 'Caching', 'Testing', 'Pipelines', 'Logs', 'Docker', 'Linux'];
    const provider = new FakeAiProvider(() => JSON.stringify({ ...FAKE_PREP, project: { ...FAKE_PREP.project, touches } }));
    const ai = await withProvider(provider);
    expect((await ai.prepJob(PREP_IN)).plan.project.touches).toEqual(touches.slice(0, 6));
    expect(provider.calls).toHaveLength(1);
    const plan = provider.calls[0]!.jsonSchema!.schema as { properties: { project: { properties: { touches: { maxItems?: number } } } } };
    expect(plan.properties.project.properties.touches.maxItems).toBe(6);
  });

  it("prepJob sends schema 'prep_plan' with the prep task's settings, the notes and the brief's needs, gaps and answers", async () => {
    const provider = new FakeAiProvider();
    const ai = await withProvider(provider);
    const { plan, by } = await ai.prepJob(PREP_IN);
    expect(by).toBe('Bonsai 2');
    expect(plan).toEqual(FAKE_PREP);
    const req = provider.callsFor('prep_plan')[0]!;
    expect(req).toMatchObject({ temperature: 0.4, maxTokens: 4096, thinking: true, thinkingEffort: 'low' });
    const user = req.messages[1]!.content;
    expect(user).toContain('3 Nov 2026: Email, 3 Nov 2026 (interview)');
    expect(user).toContain('  The move: I moved the web app to TypeScript.');
    expect(user).toContain('- Go: A side project.');
    expect(user).toContain('- Have you used Go? Yes, in a side project for a year.');
    // A prep plan has no letter to address, or open.
    expect(user).not.toContain('Who to write to');
    expect(user).not.toContain('Opening line');
    expect(user.endsWith(PREP_IN.ad)).toBe(true);
  });

  it('prepJob with no brief says there is none yet, and removes any link from the plan', async () => {
    const linked = { ...FAKE_PREP, ask: [{ question: 'Is the team at https://example.com/team?', why: 'See www.example.com.' }] };
    const provider = new FakeAiProvider(() => JSON.stringify(linked));
    const ai = await withProvider(provider);
    const { plan } = await ai.prepJob({ ...PREP_IN, brief: null });
    expect(provider.calls[0]!.messages[1]!.content).toContain('The brief for this job (the needs, my stories, the gaps and my answers):\n\nNo brief yet.');
    expect(plan.ask).toEqual([{ question: 'Is the team at?', why: 'See.' }]);
  });

  // llama-server reuses its cache only when the start of the prompt is the
  // same: the four writing tasks send the same system message.
  it('the brief, the prep plan, the resume and the cover letter send the same system message for the same profile', async () => {
    const provider = new FakeAiProvider((req) => (req.jsonSchema ? defaultReply(req) : 'A document.'));
    const ai = await withProvider(provider);
    const profile = '\n  # Sam Taylor\nSenior engineer.  \n';
    await ai.briefJob({ ...BRIEF_IN, profile });
    await ai.prepJob({ ...PREP_IN, profile });
    const write = { profile, guide: 'Keep it short.', job: BRIEF_IN.job, ad: BRIEF_IN.ad, today: '3 November 2026', notes: NOTES, brief: PLAN };
    for await (const _ of ai.writeDocument({ ...write, kind: 'resume' }));
    for await (const _ of ai.writeDocument({ ...write, kind: 'cover_letter' }));
    const systems = provider.calls.map((c) => c.messages[0]!);
    expect(systems).toHaveLength(4);
    for (const system of systems) expect(system).toEqual(systems[0]);
  });

  it('onStart is told the AI the work runs on, once, as it starts', async () => {
    const provider = new FakeAiProvider();
    const ai = await withProvider(provider);
    const started: { by: string; sent: number }[] = [];
    await ai.briefJob(BRIEF_IN, { onStart: (by) => started.push({ by, sent: provider.calls.length }) });
    expect(started).toEqual([{ by: 'Bonsai 2', sent: 0 }]);
    await ai.prepJob(PREP_IN, { onStart: (by) => started.push({ by, sent: provider.calls.length }) });
    expect(started).toEqual([
      { by: 'Bonsai 2', sent: 0 },
      { by: 'Bonsai 2', sent: 1 },
    ]);
  });

  it('onStart is never told about a task cancelled before it starts', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const provider = new FakeAiProvider(async (req) => {
      if (req.jsonSchema?.name === 'parsed_job') await held;
      return defaultReply(req);
    });
    const ai = await withProvider(provider);
    const onStart = vi.fn();
    // Waiting behind an ad being read, then cancelled.
    const parsed = ai.parseJob('An ad.');
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    const controller = new AbortController();
    const brief = ai.briefJob(BRIEF_IN, { signal: controller.signal, onStart });
    controller.abort();
    await expect(brief).rejects.toMatchObject({ name: 'AbortError' });
    // Cancelled before it was asked for.
    await expect(ai.prepJob(PREP_IN, { signal: AbortSignal.abort(), onStart })).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await parsed;
    await ai.onIdle();
    expect(onStart).not.toHaveBeenCalled();
    expect(provider.calls.map((c) => c.jsonSchema?.name)).toEqual(['parsed_job']);
  });
});

// The browser tests and the screenshot tool use these answers.
describe('the smart fake, through the writing tasks', () => {
  const AD = 'Senior Engineer\nExample Co\nYou will help our engineers ship faster, every day.\n- TypeScript\n- Go';
  const base = { profile: E2E_PROFILE, job: 'Role: Senior Engineer', ad: AD, notes: [], today: '3 November 2026' };

  it("makes a brief that quotes the ad, and a plan, both within their caps, and tells a letter from a resume by the user part", async () => {
    const { provider } = createSmartFake();
    const ai = await withProvider(provider);
    const { brief } = await ai.briefJob({ ...base, answers: [] });
    expect(brief.opening).toMatchObject({ quote: 'You will help our engineers ship faster, every day.', inAd: true });
    expect(brief).toMatchObject({ needs: expect.any(Array), gaps: FAKE_BRIEF.gaps, questions: FAKE_BRIEF.questions });
    expect(brief.needs.map((n) => n.others.length)).toEqual([2, 2, 2]);
    expect((await ai.prepJob({ ...base, brief: null })).plan).toEqual(FAKE_PREP);
    const write = { ...base, guide: 'My cover letter guide. Never write a resume here.', brief: null };
    let letter = '';
    for await (const chunk of ai.writeDocument({ ...write, kind: 'cover_letter' })) letter += chunk;
    let resume = '';
    for await (const chunk of ai.writeDocument({ ...write, kind: 'resume' })) resume += chunk;
    expect(letter).toBe(FAKE_COVER_LETTER);
    expect(resume).toBe(FAKE_RESUME);
  });
});
