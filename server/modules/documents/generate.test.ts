import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultReply, FakeAiProvider } from '../../../tests/fakes/fake-ai-provider.ts';
import { FAIL_MESSAGE } from '../../../tests/fakes/smart-fake-ai.ts';
import { pastedCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, freePort, TEST_ORIGIN, type TestApp } from '../../../tests/helpers/test-app.ts';
import { createApiClient } from '../../../shared/api-client.ts';
import { AiUnavailableError } from '../../core/errors.ts';

const RESUME = '# Sam Taylor\n\n## Experience\n\n- Moved the web app to TypeScript.\n';

let app: TestApp;
let provider: FakeAiProvider;
let jobId: number;

async function setup(opts: { port?: number } = {}) {
  provider = new FakeAiProvider((req) => (req.jsonSchema ? defaultReply(req) : RESUME));
  provider.thinking = 'Thinking about Sam.';
  app = await createTestApp({ fakes: { ai: provider }, port: opts.port });
  const saved = app.services.jobs.save({
    capture: pastedCapture('Senior Engineer\nAtlassian\nWe want TypeScript and Go.'),
    fields: { title: 'Senior Engineer', company: 'Atlassian' },
  });
  if (saved.result !== 'created') throw new Error('setup failed');
  jobId = saved.job.id;
  await app.services.enrich.onIdle();
  app.services.profile.write('master-profile', '# Sam Taylor\nMoved the web app to TypeScript.');
}

afterEach(async () => {
  await app.cleanup();
});

// The test helper parses a one-line reply as JSON, so take either form.
const lines = (body: unknown) =>
  (typeof body === 'string' ? body : JSON.stringify(body))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { kind: string; text?: string; message?: string });

describe('generate', () => {
  beforeEach(() => setup());

  it('streams the document as lines of JSON, ending with done, and saves nothing', async () => {
    const res = await app.request('POST', `/api/v1/jobs/${jobId}/documents/generate`, { kind: 'resume' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
    const chunks = lines(res.body);
    expect(chunks.at(-1)).toEqual({ kind: 'done' });
    expect(chunks.filter((c) => c.kind === 'text').map((c) => c.text).join('')).toBe(RESUME);
    expect(JSON.stringify(chunks)).not.toContain('Thinking');
    expect(app.services.documents.list(jobId)).toEqual([]);
  });

  it("sends the job's details, its newest ad and the resume guide to the AI", async () => {
    app.services.profile.write('resume-guide', 'One page only.');
    await app.request('POST', `/api/v1/jobs/${jobId}/documents/generate`, { kind: 'resume' });
    const [system, user] = provider.callsFor('write')[0]!.messages;
    expect(system!.content).toContain('One page only.');
    expect(user!.content).toContain('Atlassian');
    expect(user!.content).toContain('Senior Engineer');
    expect(user!.content).toContain('We want TypeScript and Go.');
  });

  it('needs your master profile first', async () => {
    app.services.profile.write('master-profile', '  ');
    const res = await app.request('POST', `/api/v1/jobs/${jobId}/documents/generate`, { kind: 'cover_letter' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Add your master profile first: Settings → Profile.');
    expect(provider.callsFor('write')).toEqual([]);
  });

  it('is a 404 for a job that is not there', async () => {
    const res = await app.request('POST', '/api/v1/jobs/999/documents/generate', { kind: 'resume' });
    expect(res.status).toBe(404);
  });

  it("ends with the AI's error when it can't be reached", async () => {
    provider.reply = (req) => (req.jsonSchema ? defaultReply(req) : new AiUnavailableError(FAIL_MESSAGE));
    const res = await app.request('POST', `/api/v1/jobs/${jobId}/documents/generate`, { kind: 'resume' });
    expect(res.status).toBe(200);
    expect(lines(res.body).at(-1)).toEqual({ kind: 'error', message: FAIL_MESSAGE });
  });
});

describe('generate, closed part-way', () => {
  it('closing the request stops the AI, and nothing is saved', async () => {
    const port = await freePort();
    await setup({ port });
    provider.chunkDelayMs = 50;
    await app.http.listen({ host: '127.0.0.1', port });
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/jobs/${jobId}/documents/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_ORIGIN.replace('4777', String(port)) },
      body: JSON.stringify({ kind: 'resume' }),
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();
    const idle = await Promise.race([app.services.ai.onIdle().then(() => true), new Promise((r) => setTimeout(() => r(false), 1000))]);
    expect(idle).toBe(true);
    expect(provider.finished.filter((c) => !c.jsonSchema)).toEqual([]);
    expect(app.services.documents.list(jobId)).toEqual([]);
  });
});

describe('generate, left early by the client', () => {
  it('leaving the loop stops the AI, even without cancelling the request', async () => {
    const port = await freePort();
    await setup({ port });
    provider.chunkDelayMs = 50;
    await app.http.listen({ host: '127.0.0.1', port });
    const api = createApiClient({ baseUrl: `http://127.0.0.1:${port}`, headers: { origin: TEST_ORIGIN.replace('4777', String(port)) } });
    for await (const chunk of api.generateDocument(jobId, 'resume')) {
      expect(chunk.kind).toBe('text');
      break;
    }
    const idle = await Promise.race([app.services.ai.onIdle().then(() => true), new Promise((r) => setTimeout(() => r(false), 1000))]);
    expect(idle).toBe(true);
    expect(provider.finished.filter((c) => !c.jsonSchema)).toEqual([]);
  });
});
