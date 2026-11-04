import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultReply, FAKE_BRIEF, FakeAiProvider } from '../../../tests/fakes/fake-ai-provider.ts';
import { FAIL_MESSAGE } from '../../../tests/fakes/smart-fake-ai.ts';
import { pastedCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, freePort, TEST_ORIGIN, type TestApp } from '../../../tests/helpers/test-app.ts';
import { createApiClient } from '../../../shared/api-client.ts';
import { AiUnavailableError } from '../../core/errors.ts';

const RESUME = '# Sam Taylor\n\n## Experience\n\n- Moved the web app to TypeScript.\n';

let app: TestApp;
let provider: FakeAiProvider;
let jobId: number;

async function setup(opts: { port?: number; heartbeatMs?: number } = {}) {
  provider = new FakeAiProvider((req) => (req.jsonSchema ? defaultReply(req) : RESUME));
  provider.thinking = 'Thinking about Sam.';
  app = await createTestApp({ fakes: { ai: provider }, port: opts.port, heartbeatMs: opts.heartbeatMs });
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
    .map((l) => JSON.parse(l) as { kind: string; text?: string; message?: string; by?: string });

describe('generate', () => {
  beforeEach(() => setup());

  it('streams the document as lines of JSON, ending with done, and saves nothing', async () => {
    const res = await app.request('POST', `/api/v1/jobs/${jobId}/documents/generate`, { kind: 'resume' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
    const chunks = lines(res.body);
    // Who's writing: the writing AI picked as it was queued, then the one it runs on.
    expect(chunks.slice(0, 2)).toEqual([
      { kind: 'waiting', by: 'Bonsai 2' },
      { kind: 'working', by: 'Bonsai 2' },
    ]);
    expect(chunks.at(-1)).toEqual({ kind: 'done' });
    expect(chunks.filter((c) => c.kind === 'text').map((c) => c.text).join('')).toBe(RESUME);
    expect(JSON.stringify(chunks)).not.toContain('Thinking');
    expect(app.services.documents.list(jobId)).toEqual([]);
  });

  it("sends the job's details, its newest ad and the resume guide to the AI", async () => {
    app.services.profile.write('resume-guide', 'One page only.');
    await app.request('POST', `/api/v1/jobs/${jobId}/documents/generate`, { kind: 'resume' });
    const [system, user] = provider.callsFor('write')[0]!.messages;
    // The guide is the task's: it goes in the user part. The system part is the profile's, shared by every writing task.
    expect(system!.content).not.toContain('One page only.');
    expect(user!.content).toContain('One page only.');
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

describe('generate, with the notes and the brief', () => {
  beforeEach(() => setup());

  const generate = (body: object, headers?: Record<string, string>) =>
    app.request('POST', `/api/v1/jobs/${jobId}/documents/generate`, body, headers);
  const userPart = () => provider.callsFor('write')[0]!.messages[1]!.content;
  const makeBrief = () => app.services.prep.makeBrief(jobId, { signal: new AbortController().signal, onLine: () => {} });

  it("with 'use', the writer gets the brief you checked and the job's notes, and the brief is marked approved", async () => {
    app.services.notes.add(jobId, 'Alex wants a short letter.');
    const brief = await makeBrief();
    app.services.prep.editBrief(brief.id, { needs: [{ chosen: 1, dropped: false }, { chosen: 0, dropped: true }, { chosen: 0, dropped: false }] });
    const res = await generate({ kind: 'cover_letter', brief: 'use' });
    expect(lines(res.body).at(-1)).toEqual({ kind: 'done' });

    const user = userPart();
    expect(user).toContain('Who to write to:\n- Name: Alex');
    expect(user).toContain(`"${FAKE_BRIEF.opening.quote}"`);
    expect(user).toContain(`- ${FAKE_BRIEF.needs[0]!.need}\n  ${FAKE_BRIEF.needs[0]!.others[0]!.title}:`);
    // A dropped need never reaches the writer.
    expect(user).not.toContain(FAKE_BRIEF.needs[1]!.need);
    expect(user).toMatch(/\d{1,2} [A-Z][a-z]{2} \d{4}: Alex wants a short letter\./);
    expect(user).not.toContain('No brief:');
    expect(user).not.toContain('No notes.');
    expect(app.services.prep.brief(jobId)!.approvedAt).not.toBeNull();
  });

  it("with 'skip', the writer gets the notes, newest first, and plans the document itself", async () => {
    app.services.notes.add(jobId, 'Alex wants a short letter.');
    app.services.notes.add(jobId, 'Alex called back: address it to Sam Lee.');
    await makeBrief();
    await generate({ kind: 'cover_letter', brief: 'skip' });
    const user = userPart();
    expect(user.indexOf('Alex wants a short letter.')).toBeGreaterThan(user.indexOf('Alex called back: address it to Sam Lee.'));
    expect(user.indexOf('Alex called back: address it to Sam Lee.')).toBeGreaterThan(-1);
    expect(user).toContain('No brief: plan it yourself, as my guide says.');
    expect(user).not.toContain(FAKE_BRIEF.needs[0]!.need);
    expect(app.services.prep.brief(jobId)!.approvedAt).toBeNull();
  });

  it("is 'skip' when the request doesn't say, and a job with no notes says so", async () => {
    await makeBrief();
    await generate({ kind: 'resume' });
    expect(userPart()).toContain('No brief: plan it yourself, as my guide says.');
    expect(userPart()).toContain('No notes.');
    expect(app.services.prep.brief(jobId)!.approvedAt).toBeNull();
  });

  // The editor sends the brief it shows, so it never writes with one you haven't seen.
  it("with 'use' and the id of a brief that isn't the job's newest, it's a 409 before the stream, and nothing is marked", async () => {
    const older = await makeBrief();
    const newest = await makeBrief();
    const stale = await generate({ kind: 'cover_letter', brief: 'use', briefId: older.id });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toEqual({ code: 'conflict', message: "There's a newer brief for this job. Reload the page to see it." });
    expect(provider.callsFor('write')).toEqual([]);
    expect(app.services.prep.brief(jobId)!.approvedAt).toBeNull();

    const fresh = await generate({ kind: 'cover_letter', brief: 'use', briefId: newest.id });
    expect(lines(fresh.body).at(-1)).toEqual({ kind: 'done' });
    expect(app.services.prep.brief(jobId)!.approvedAt).not.toBeNull();
    // Skip writes without a brief, whatever it was sent.
    expect(lines((await generate({ kind: 'resume', brief: 'skip', briefId: older.id })).body).at(-1)).toEqual({ kind: 'done' });
  });

  it("with 'use' and no brief, it's refused before the stream, with what to do", async () => {
    const res = await generate({ kind: 'cover_letter', brief: 'use' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Make a brief first, or press Skip, just write.');
    expect(provider.callsFor('write')).toEqual([]);
  });

  it('only the dashboard can write a document', async () => {
    const res = await generate({ kind: 'resume' }, { origin: 'moz-extension://8f2c1a7e-0000-4000-8000-000000000000' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Only the dashboard can write documents.');
    expect(provider.callsFor('write')).toEqual([]);
  });
});

describe('generate, replaced or quiet', () => {
  it('a draft replaced by a newer one for the same document ends with a sentence that says so', async () => {
    await setup();
    provider.delayMs = 100;
    const older = app.request('POST', `/api/v1/jobs/${jobId}/documents/generate`, { kind: 'resume' });
    await vi.waitFor(() => expect(provider.callsFor('write')).toHaveLength(1));
    const newer = await app.request('POST', `/api/v1/jobs/${jobId}/documents/generate`, { kind: 'resume' });
    const replaced = lines((await older).body);
    expect(replaced.map((c) => c.kind)).toEqual(['waiting', 'working', 'error']);
    expect(replaced.at(-1)).toEqual({ kind: 'error', message: 'A newer draft took its place.' });
    expect(lines(newer.body).at(-1)).toEqual({ kind: 'done' });
  });

  it('a draft stopped with the app ends with no sentence of its own', async () => {
    await setup();
    provider.delayMs = 100;
    const stopped = app.request('POST', `/api/v1/jobs/${jobId}/documents/generate`, { kind: 'resume' });
    await vi.waitFor(() => expect(provider.callsFor('write')).toHaveLength(1));
    await app.services.ai.stop();
    expect(lines((await stopped).body).map((c) => c.kind)).toEqual(['waiting', 'working']);
  });

  // The test makes 20 seconds 20 milliseconds.
  it('a quiet draft says it is still there while the AI thinks, then writes and ends with done', async () => {
    await setup({ heartbeatMs: 20 });
    provider.delayMs = 150;
    const kinds = lines((await app.request('POST', `/api/v1/jobs/${jobId}/documents/generate`, { kind: 'resume' })).body).map((c) => c.kind);
    expect(kinds.slice(0, 3)).toEqual(['waiting', 'working', 'alive']);
    expect(kinds.at(-1)).toBe('done');
    const firstText = kinds.indexOf('text');
    expect(kinds.slice(2, firstText).every((kind) => kind === 'alive')).toBe(true);
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
    // Who's writing comes first, then the text.
    for await (const chunk of api.generateDocument(jobId, 'resume')) {
      if (chunk.kind === 'text') break;
    }
    const idle = await Promise.race([app.services.ai.onIdle().then(() => true), new Promise((r) => setTimeout(() => r(false), 1000))]);
    expect(idle).toBe(true);
    expect(provider.finished.filter((c) => !c.jsonSchema)).toEqual([]);
  });
});
