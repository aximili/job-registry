import { afterEach, describe, expect, it } from 'vitest';
import { defaultReply, FakeAiProvider } from '../../../tests/fakes/fake-ai-provider.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';
import type { WriteInput } from './index.ts';

const RESUME = '# Sam Taylor\n\nsam@example.com\n\n## Experience\n\n- Moved the web app to TypeScript.';

const INPUT: WriteInput = {
  kind: 'resume',
  profile: '# Sam Taylor\nSenior engineer. Moved the web app to TypeScript.',
  guide: 'Two pages at most.',
  job: 'Role: Senior Engineer\nCompany: Atlassian',
  ad: 'We want someone who knows TypeScript.',
  today: '28 October 2026',
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

  it('thinks first, with no limit, and puts the profile before the job', async () => {
    const provider = writer();
    app = await createTestApp({ fakes: { ai: provider } });
    await collect(app.services.ai.writeDocument(INPUT));
    const req = provider.callsFor('write')[0]!;
    expect(req).toMatchObject({ thinking: true, thinkingEffort: 'max', maxTokens: 8192, temperature: 0.6 });
    expect(req.jsonSchema).toBeUndefined();
    const [system, user] = req.messages;
    expect(system!.role).toBe('system');
    expect(system!.content).toContain('Moved the web app to TypeScript.');
    expect(system!.content).toContain('Two pages at most.');
    expect(system!.content).toContain('Never invent');
    expect(user!.content).toContain('Company: Atlassian');
    expect(user!.content).toContain('We want someone who knows TypeScript.');
    expect(user!.content).not.toContain('Moved the web app');
  });

  it('a cover letter uses its own prompt, dated today', async () => {
    const provider = writer('Dear Hiring Manager,');
    app = await createTestApp({ fakes: { ai: provider } });
    await collect(app.services.ai.writeDocument({ ...INPUT, kind: 'cover_letter', guide: null }));
    const [system, user] = provider.callsFor('write')[0]!.messages;
    expect(system!.content).toMatch(/cover letter/i);
    expect(system!.content).toContain('No guide given.');
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
