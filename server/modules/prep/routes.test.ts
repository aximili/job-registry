// The brief's endpoints: the stream of lines while it's made, the edits, and
// the answers added to your profile. Then the prep plan's: its stream and
// the job's plans. Every write is the dashboard's only.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { Brief, BriefLine, PrepLine, type PrepPlan } from '../../../shared/contracts/index.ts';
import { defaultReply, FakeAiProvider } from '../../../tests/fakes/fake-ai-provider.ts';
import { FAIL_MESSAGE } from '../../../tests/fakes/smart-fake-ai.ts';
import { pastedCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, freePort, TEST_ORIGIN, type TestApp } from '../../../tests/helpers/test-app.ts';
import { AiUnavailableError } from '../../core/errors.ts';
import { HEARTBEAT_MS } from '../../core/http/lines.ts';

const fromExtension = { origin: 'moz-extension://8f2c1a7e-0000-4000-8000-000000000000' };
const unanswered = { answer: null, skipped: false, addToProfile: false };

let app: TestApp;
let provider: FakeAiProvider;
let jobId: number;

async function setup(opts: { port?: number; heartbeatMs?: number } = {}) {
  provider = new FakeAiProvider();
  app = await createTestApp({ fakes: { ai: provider }, port: opts.port, heartbeatMs: opts.heartbeatMs });
  const saved = app.services.jobs.save({
    capture: pastedCapture("Senior Engineer\nExample Co\nYou'll help our engineers ship faster."),
    fields: { title: 'Senior Engineer', company: 'Example Co' },
  });
  if (saved.result !== 'created') throw new Error('setup failed');
  jobId = saved.job.id;
  await app.services.enrich.onIdle();
  app.services.profile.write('master-profile', '# Sam Taylor\nSenior engineer at Example Co.\n');
}

afterEach(async () => {
  await app.cleanup();
});

// The test helper parses a one-line reply as JSON, so take either form.
const linesOf =
  <S extends z.ZodType>(schema: S) =>
  (body: unknown): z.infer<S>[] =>
    (typeof body === 'string' ? body : JSON.stringify(body))
      .split('\n')
      .filter(Boolean)
      .map((l) => schema.parse(JSON.parse(l)));
const lines = linesOf(BriefLine);
const planLines = linesOf(PrepLine);

async function made(): Promise<Brief> {
  const res = await app.request('POST', `/api/v1/jobs/${jobId}/brief`, {});
  const done = lines(res.body).at(-1);
  if (done?.kind !== 'done') throw new Error(`no brief: ${JSON.stringify(res.body)}`);
  return done.brief;
}

async function planned(): Promise<PrepPlan> {
  const res = await app.request('POST', `/api/v1/jobs/${jobId}/prep`, {});
  const done = planLines(res.body).at(-1);
  if (done?.kind !== 'done') throw new Error(`no plan: ${JSON.stringify(res.body)}`);
  return done.plan;
}

describe('the brief over HTTP', () => {
  it('streams waiting, working and done as lines of JSON, and the brief is the job’s', async () => {
    await setup();
    expect((await app.request('GET', `/api/v1/jobs/${jobId}/brief`)).body).toEqual({ brief: null });

    const res = await app.request('POST', `/api/v1/jobs/${jobId}/brief`, {});
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
    const sent = lines(res.body);
    expect(sent.map((l) => l.kind)).toEqual(['waiting', 'working', 'done']);
    // Who's writing, from the start: the writing AI picked as it was queued.
    expect(sent[0]).toEqual({ kind: 'waiting', by: 'Bonsai 2' });
    expect(sent[1]).toEqual({ kind: 'working', by: 'Bonsai 2' });

    const got = await app.request('GET', `/api/v1/jobs/${jobId}/brief`);
    expect(got.status).toBe(200);
    expect(got.body).toEqual({ brief: sent[2]!.kind === 'done' ? sent[2]!.brief : null });
  });

  it('refuses a missing job and a missing master profile before the stream starts', async () => {
    await setup();
    const missing = await app.request('POST', '/api/v1/jobs/999/brief', {});
    expect(missing.status).toBe(404);
    expect((await app.request('GET', '/api/v1/jobs/999/brief')).status).toBe(404);
    app.services.profile.write('master-profile', ' ');
    const noProfile = await app.request('POST', `/api/v1/jobs/${jobId}/brief`, {});
    expect(noProfile.status).toBe(400);
    expect(noProfile.body.error.message).toBe('Add your master profile first: Settings → Profile.');
    expect(provider.callsFor('brief')).toEqual([]);
  });

  it("ends with the AI's sentence when it can't make the brief, and saves nothing", async () => {
    await setup();
    provider.reply = (req) => (req.jsonSchema?.name === 'brief' ? new AiUnavailableError(FAIL_MESSAGE) : defaultReply(req));
    const res = await app.request('POST', `/api/v1/jobs/${jobId}/brief`, {});
    expect(res.status).toBe(200);
    expect(lines(res.body).at(-1)).toEqual({ kind: 'error', message: FAIL_MESSAGE });
    expect((await app.request('GET', `/api/v1/jobs/${jobId}/brief`)).body).toEqual({ brief: null });
  });

  it('a mistake in the code gets a plain sentence, not its own message', async () => {
    await setup();
    provider.reply = (req) => (req.jsonSchema?.name === 'brief' ? new Error('secret internals') : defaultReply(req));
    const res = await app.request('POST', `/api/v1/jobs/${jobId}/brief`, {});
    const last = lines(res.body).at(-1);
    expect(last).toEqual({ kind: 'error', message: 'Something went wrong while making the brief. See the log for details.' });
  });

  it('edits the brief and answers with it', async () => {
    await setup();
    const brief = await made();
    const res = await app.request('PATCH', `/api/v1/briefs/${brief.id}`, { contact: { name: 'Alex Chen', recruiter: false } });
    expect(res.status).toBe(200);
    expect(Brief.parse(res.body).contact).toMatchObject({ name: 'Alex Chen', recruiter: false });
    expect((await app.request('PATCH', '/api/v1/briefs/999', { contact: { name: 'Alex', recruiter: true } })).status).toBe(404);
  });

  it('refuses an edit it does not know, or an answer over 240 characters', async () => {
    await setup();
    const brief = await made();
    const unknown = await app.request('PATCH', `/api/v1/briefs/${brief.id}`, { gaps: [] });
    expect(unknown.status).toBe(400);
    const long = await app.request('PATCH', `/api/v1/briefs/${brief.id}`, {
      questions: [{ answer: 'x'.repeat(241), skipped: false, addToProfile: false }, unanswered, unanswered],
    });
    expect(long.status).toBe(400);
    expect(long.body.error.message).toContain('An answer can be 240 characters at most.');
  });

  it('adds the ticked answers once, even when pressed twice at once', async () => {
    await setup();
    const brief = await made();
    await app.request('PATCH', `/api/v1/briefs/${brief.id}`, {
      questions: [{ answer: 'Yes, a small CLI in Go.', skipped: false, addToProfile: true }, unanswered, unanswered],
    });
    const both = await Promise.all([
      app.request('POST', `/api/v1/briefs/${brief.id}/answers-to-profile`, {}),
      app.request('POST', `/api/v1/briefs/${brief.id}/answers-to-profile`, {}),
    ]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(both.map((r) => r.body.added).sort()).toEqual([0, 1]);
    const text = app.services.profile.read('master-profile') ?? '';
    expect(text.match(/a small CLI in Go/g)).toHaveLength(1);
  });

  it('only the dashboard can make a brief, edit one or add its answers to your profile', async () => {
    await setup();
    const brief = await made();
    const before = app.services.profile.read('master-profile');
    const calls = provider.callsFor('brief').length;
    const writes: [string, string, unknown, string][] = [
      ['POST', `/api/v1/jobs/${jobId}/brief`, {}, 'Only the dashboard can make or change a brief.'],
      ['PATCH', `/api/v1/briefs/${brief.id}`, { contact: { name: 'Alex', recruiter: true } }, 'Only the dashboard can make or change a brief.'],
      ['POST', `/api/v1/briefs/${brief.id}/answers-to-profile`, {}, 'Only the dashboard can add answers to your profile.'],
    ];
    for (const [method, path, body, message] of writes) {
      const res = await app.request(method, path, body, fromExtension);
      expect(res.status, path).toBe(403);
      expect(res.body.error.message).toBe(message);
    }
    expect(provider.callsFor('brief')).toHaveLength(calls);
    expect(app.services.prep.brief(jobId)).toEqual(brief);
    expect(app.services.profile.read('master-profile')).toBe(before);
  });
});

describe('the prep plan over HTTP', () => {
  it("streams waiting, working and done as lines of JSON, and lists the job's plans, newest first", async () => {
    await setup();
    expect((await app.request('GET', `/api/v1/jobs/${jobId}/prep`)).body).toEqual({ plans: [] });

    const res = await app.request('POST', `/api/v1/jobs/${jobId}/prep`, {});
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
    const sent = planLines(res.body);
    expect(sent.map((l) => l.kind)).toEqual(['waiting', 'working', 'done']);
    expect(sent[0]).toEqual({ kind: 'waiting', by: 'Bonsai 2' });
    expect(sent[1]).toEqual({ kind: 'working', by: 'Bonsai 2' });
    const first = sent[2]!.kind === 'done' ? sent[2]!.plan : null;

    const second = await planned();
    const got = await app.request('GET', `/api/v1/jobs/${jobId}/prep`);
    expect(got.status).toBe(200);
    expect(got.body).toEqual({ plans: [second, first] });
  });

  it('refuses a missing job and a missing master profile before the stream starts', async () => {
    await setup();
    expect((await app.request('POST', '/api/v1/jobs/999/prep', {})).status).toBe(404);
    expect((await app.request('GET', '/api/v1/jobs/999/prep')).status).toBe(404);
    app.services.profile.write('master-profile', ' ');
    const noProfile = await app.request('POST', `/api/v1/jobs/${jobId}/prep`, {});
    expect(noProfile.status).toBe(400);
    expect(noProfile.body.error.message).toBe('Add your master profile first: Settings → Profile.');
    expect(provider.callsFor('prep_plan')).toEqual([]);
  });

  it("ends with the AI's sentence when it can't make the plan, or a plain one for a mistake in the code, and saves nothing", async () => {
    await setup();
    provider.reply = (req) => (req.jsonSchema?.name === 'prep_plan' ? new AiUnavailableError(FAIL_MESSAGE) : defaultReply(req));
    const failed = await app.request('POST', `/api/v1/jobs/${jobId}/prep`, {});
    expect(failed.status).toBe(200);
    expect(planLines(failed.body).at(-1)).toEqual({ kind: 'error', message: FAIL_MESSAGE });

    provider.reply = (req) => (req.jsonSchema?.name === 'prep_plan' ? new Error('secret internals') : defaultReply(req));
    const broke = await app.request('POST', `/api/v1/jobs/${jobId}/prep`, {});
    expect(planLines(broke.body).at(-1)).toEqual({ kind: 'error', message: 'Something went wrong while making the prep plan. See the log for details.' });
    expect((await app.request('GET', `/api/v1/jobs/${jobId}/prep`)).body).toEqual({ plans: [] });
  });

  it('only the dashboard can make a plan', async () => {
    await setup();
    const res = await app.request('POST', `/api/v1/jobs/${jobId}/prep`, {}, fromExtension);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Only the dashboard can make a prep plan.');
    expect(provider.callsFor('prep_plan')).toEqual([]);
    expect(app.services.prep.plans(jobId)).toEqual([]);
  });
});

// A newer request for the same job's brief (or plan) replaces one still being
// made. The older reply is still being read, so it says why it ended.
describe('the brief and the prep plan, replaced or quiet', () => {
  it.each([
    ['brief', 'brief', 'A newer brief for this job took its place.', lines],
    ['prep', 'prep_plan', 'A newer plan for this job took its place.', planLines],
  ] as const)('a %s replaced by a newer one ends with a sentence that says so, and the newer one is done', async (path, schema, sentence, read) => {
    await setup();
    provider.delayMs = 100;
    const older = app.request('POST', `/api/v1/jobs/${jobId}/${path}`, {});
    await vi.waitFor(() => expect(provider.callsFor(schema)).toHaveLength(1));
    const newer = await app.request('POST', `/api/v1/jobs/${jobId}/${path}`, {});
    const replaced = read((await older).body);
    expect(replaced.map((l) => l.kind)).toEqual(['waiting', 'working', 'error']);
    expect(replaced.at(-1)).toEqual({ kind: 'error', message: sentence });
    expect(read(newer.body).at(-1)?.kind).toBe('done');
  });

  it.each([
    ['brief', 'brief', lines],
    ['prep', 'prep_plan', planLines],
  ] as const)('a %s stopped with the app ends with no sentence of its own', async (path, schema, read) => {
    await setup();
    provider.delayMs = 100;
    const stopped = app.request('POST', `/api/v1/jobs/${jobId}/${path}`, {});
    await vi.waitFor(() => expect(provider.callsFor(schema)).toHaveLength(1));
    await app.services.ai.stop();
    expect(read((await stopped).body).map((l) => l.kind)).toEqual(['waiting', 'working']);
  });

  // Firefox gives up on a reply that stays quiet too long, and the AI can
  // think for minutes. The test makes 20 seconds 20 milliseconds.
  it('a quiet reply says it is still there every 20 seconds', () => {
    expect(HEARTBEAT_MS).toBe(20_000);
  });

  it.each([
    ['brief', lines],
    ['prep', planLines],
  ] as const)('a quiet %s says it is still there while the AI works, then ends with done', async (path, read) => {
    await setup({ heartbeatMs: 20 });
    provider.delayMs = 150;
    const sent = read((await app.request('POST', `/api/v1/jobs/${jobId}/${path}`, {})).body).map((l) => l.kind);
    expect(sent.slice(0, 2)).toEqual(['waiting', 'working']);
    expect(sent.at(-1)).toBe('done');
    expect(sent.slice(2, -1).length).toBeGreaterThan(0);
    expect(sent.slice(2, -1).every((kind) => kind === 'alive')).toBe(true);
  });
});

describe('the brief and the prep plan, cancelled part-way', () => {
  it.each([
    ['brief', 'brief', () => app.services.prep.brief(jobId)],
    ['prep', 'prep_plan', () => app.services.prep.plans(jobId)[0] ?? null],
  ] as const)('closing the request for a %s stops the AI, and saves nothing', async (path, schema, saved) => {
    const port = await freePort();
    await setup({ port });
    provider.delayMs = 2_000;
    await app.http.listen({ host: '127.0.0.1', port });
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/jobs/${jobId}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_ORIGIN.replace('4777', String(port)) },
      body: '{}',
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"waiting"');
    controller.abort();
    const idle = await Promise.race([app.services.ai.onIdle().then(() => true), new Promise((r) => setTimeout(() => r(false), 1000))]);
    expect(idle).toBe(true);
    expect(provider.finished.filter((c) => c.jsonSchema?.name === schema)).toEqual([]);
    expect(saved()).toBeNull();
  });
});
