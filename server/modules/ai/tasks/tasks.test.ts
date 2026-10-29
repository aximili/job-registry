import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_PARSED, FAKE_RATING, FakeAiProvider, defaultReply } from '../../../../tests/fakes/fake-ai-provider.ts';
import { createTestApp, type TestApp } from '../../../../tests/helpers/test-app.ts';

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
    expect(await ai.rateJob({ profile: 'I write TypeScript.', preferences: null, ad: 'We need Go.' })).toEqual(FAKE_RATING);
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
