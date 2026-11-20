import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultReply, FAKE_BRIEF, FakeAiProvider } from '../../../tests/fakes/fake-ai-provider.ts';
import { pastedCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';
import { AiUnavailableError } from '../../core/errors.ts';

const REVISED = '# Sam Taylor\n\nRewritten resume.';
const OLD_DRAFT = '# Sam Taylor\n\nOld resume.';
const FAIL_MESSAGE = "Can't reach the AI.";

let app: TestApp;
let provider: FakeAiProvider;
let jobId: number;

async function setup() {
  provider = new FakeAiProvider((req) => (req.jsonSchema ? defaultReply(req) : REVISED));
  provider.thinking = 'Thinking about Sam.';
  app = await createTestApp({ fakes: { ai: provider } });
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

const lines = (body: unknown) =>
  (typeof body === 'string' ? body : JSON.stringify(body))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { kind: string; text?: string; message?: string; by?: string });

const revise = (body: object, headers?: Record<string, string>) =>
  app.request('POST', `/api/v1/jobs/${jobId}/documents/revise`, body, headers);
const lastWrite = () => provider.callsFor('write').at(-1)!;
const makeBrief = () => app.services.prep.makeBrief(jobId, { signal: new AbortController().signal, onLine: () => {} });

describe('revise', () => {
  beforeEach(() => setup());

  it('streams the rewrite as lines of JSON, ending with done, and saves nothing', async () => {
    const res = await revise({ kind: 'resume', note: 'Put TypeScript first.', draft: OLD_DRAFT });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
    const chunks = lines(res.body);
    expect(chunks.slice(0, 2)).toEqual([
      { kind: 'waiting', by: 'Bonsai 2' },
      { kind: 'working', by: 'Bonsai 2' },
    ]);
    expect(chunks.at(-1)).toEqual({ kind: 'done' });
    expect(chunks.filter((c) => c.kind === 'text').map((c) => c.text).join('')).toBe(REVISED);
    expect(JSON.stringify(chunks)).not.toContain('Thinking');
    expect(app.services.documents.list(jobId)).toEqual([]);
  });

  it('sends the note, the current draft, the job notes, the newest brief and the guide', async () => {
    app.services.profile.write('resume-guide', 'One page only.');
    app.services.notes.add(jobId, 'Alex wants a shorter resume.');
    const brief = await makeBrief();
    const res = await revise({ kind: 'resume', note: 'Use my TypeScript story.', draft: OLD_DRAFT });
    expect(lines(res.body).at(-1)).toEqual({ kind: 'done' });

    const [system, user] = lastWrite().messages;
    expect(system!.content).toContain('Moved the web app to TypeScript.');
    expect(system!.content).not.toContain('One page only.');
    expect(user!.content).toContain('Use my TypeScript story.');
    expect(user!.content).toContain(OLD_DRAFT);
    expect(user!.content).toContain('One page only.');
    expect(user!.content).toContain('Alex wants a shorter resume.');
    expect(user!.content).toContain(FAKE_BRIEF.needs[0]!.need);
    expect(user!.content).not.toContain('No brief:');
    expect(app.services.prep.brief(jobId)!.approvedAt).toBeNull();
  });

  it('needs your master profile first', async () => {
    app.services.profile.write('master-profile', '  ');
    const res = await revise({ kind: 'resume', note: 'Fix it', draft: OLD_DRAFT });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Add your master profile first: Settings → Profile.');
    expect(provider.callsFor('write')).toEqual([]);
  });

  it('is a 404 for a job that is not there', async () => {
    const res = await app.request('POST', '/api/v1/jobs/999/documents/revise', { kind: 'resume', note: 'Fix it', draft: OLD_DRAFT });
    expect(res.status).toBe(404);
  });

  it("ends with the AI's error when it can't be reached", async () => {
    provider.reply = (req) => (req.jsonSchema ? defaultReply(req) : new AiUnavailableError(FAIL_MESSAGE));
    const res = await revise({ kind: 'resume', note: 'Fix it', draft: OLD_DRAFT });
    expect(res.status).toBe(200);
    expect(lines(res.body).at(-1)).toEqual({ kind: 'error', message: FAIL_MESSAGE });
  });

  it('only the dashboard can rewrite a document', async () => {
    const res = await revise(
      { kind: 'resume', note: 'Fix it', draft: OLD_DRAFT },
      { origin: 'moz-extension://8f2c1a7e-0000-4000-8000-000000000000' },
    );
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Only the dashboard can write documents.');
    expect(provider.callsFor('write')).toEqual([]);
  });

  it('refuses a blank note before the AI is called', async () => {
    const res = await revise({ kind: 'resume', note: '  ', draft: OLD_DRAFT });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Say what to change first.');
    expect(provider.callsFor('write')).toEqual([]);
  });

  it('a rewrite replaced by a newer draft for the same document ends with a sentence that says so', async () => {
    provider.delayMs = 100;
    const older = app.request('POST', `/api/v1/jobs/${jobId}/documents/generate`, { kind: 'resume' });
    await vi.waitFor(() => expect(provider.callsFor('write')).toHaveLength(1));
    const newer = await revise({ kind: 'resume', note: 'Put TypeScript first.', draft: OLD_DRAFT });
    expect(lines((await older).body).map((c) => c.kind)).toEqual(['waiting', 'working', 'error']);
    expect(lines((await older).body).at(-1)).toEqual({ kind: 'error', message: 'A newer draft took its place.' });
    expect(lines(newer.body).at(-1)).toEqual({ kind: 'done' });
  });
});
