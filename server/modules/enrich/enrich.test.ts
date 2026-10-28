import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_PARSED, FAKE_RATING, FakeAiProvider, defaultReply } from '../../../tests/fakes/fake-ai-provider.ts';
import { pastedCapture, seekCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';
import { AiRefusedError, AiUnavailableError } from '../../core/errors.ts';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function setup(opts: { provider?: FakeAiProvider; profile?: boolean } = {}) {
  app = await createTestApp({ fakes: { ai: opts.provider ?? new FakeAiProvider() } });
  if (opts.profile) {
    mkdirSync(join(app.root, 'profile'), { recursive: true });
    writeFileSync(join(app.root, 'profile', 'master-profile.md'), 'I write TypeScript.');
  }
  return app;
}

function save(app: TestApp, capture = pastedCapture('Senior Engineer\nAtlassian\nWe need TypeScript.'), fields = {}) {
  const res = app.services.jobs.save({ capture, fields, decision: 'new' });
  if (res.result !== 'created') throw new Error('setup failed');
  return res.job;
}

describe('enrich', () => {
  it('saving returns at once, and the AI fills in the job afterwards', async () => {
    const app = await setup({ provider: new FakeAiProvider(undefined, { delayMs: 300 }) });
    const started = Date.now();
    const job = save(app);
    expect(Date.now() - started).toBeLessThan(50);
    expect(job.parseState).toBe('pending');
    await app.services.enrich.onIdle();
    expect(app.services.jobs.get(job.id)).toMatchObject({ title: FAKE_PARSED.title, company: FAKE_PARSED.company, parseState: 'done' });
  });

  it('the job is rated after it is read, when there is a master profile', async () => {
    const app = await setup({ profile: true });
    const job = save(app);
    await app.services.enrich.onIdle();
    expect(app.services.jobs.get(job.id).match).toEqual(FAKE_RATING);
  });

  it('with no master profile the job is read but not rated', async () => {
    const provider = new FakeAiProvider();
    const app = await setup({ provider });
    const job = save(app);
    await app.services.enrich.onIdle();
    expect(app.services.jobs.get(job.id)).toMatchObject({ parseState: 'done', match: null });
    expect(provider.callsFor('rating')).toHaveLength(0);
  });

  it("when the AI can't be reached, the job waits for it, says why and keeps its ad", async () => {
    const down = "Can't reach the AI at http://127.0.0.1:8080/v1. Check that it's running, or pick another AI in Settings.";
    const app = await setup({ provider: new FakeAiProvider(() => new AiUnavailableError(down)) });
    const failed: unknown[] = [];
    app.bus.on('enrich.failed', (e) => failed.push(e));
    const job = save(app);
    await app.services.enrich.onIdle();
    expect(app.services.jobs.get(job.id)).toMatchObject({ parseState: 'pending', parseError: down });
    expect(app.services.jobs.listPostings(job.id)[0]!.jdText).toContain('We need TypeScript.');
    expect(failed).toEqual([{ jobId: job.id, step: 'parse', error: down }]);
  });

  it('Parse again reads the ad again and rates it afresh', async () => {
    let down = true;
    const provider = new FakeAiProvider((req) => (down ? new AiUnavailableError("Can't reach the AI.") : defaultReply(req)));
    const app = await setup({ provider, profile: true });
    const job = save(app);
    await app.services.enrich.onIdle();
    expect(app.services.jobs.get(job.id).parseState).toBe('pending');
    down = false;
    const res = await app.request('POST', `/api/v1/jobs/${job.id}/reparse`, {});
    expect(res.status).toBe(202);
    expect(res.body.parseState).toBe('pending');
    await app.services.enrich.onIdle();
    expect(app.services.jobs.get(job.id)).toMatchObject({ parseState: 'done', title: FAKE_PARSED.title, match: FAKE_RATING });
    // A second Parse again rates afresh rather than reusing the cache.
    await app.request('POST', `/api/v1/jobs/${job.id}/reparse`, {});
    await app.services.enrich.onIdle();
    expect(provider.callsFor('rating')).toHaveLength(2);
  });

  it('Parse again on a job with no ad text says so', async () => {
    const app = await setup();
    const job = save(app, pastedCapture('   '));
    const res = await app.request('POST', `/api/v1/jobs/${job.id}/reparse`, {});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('This job has no ad text to read.');
    expect((await app.request('POST', '/api/v1/jobs/999/reparse', {})).status).toBe(404);
  });

  it('a failed rating keeps what was read', async () => {
    const provider = new FakeAiProvider((req) => (req.jsonSchema?.name === 'rating' ? new AiUnavailableError('Timed out.') : defaultReply(req)));
    const app = await setup({ provider, profile: true });
    const failed: { step: string }[] = [];
    app.bus.on('enrich.failed', (e) => failed.push(e));
    const job = save(app);
    await app.services.enrich.onIdle();
    expect(app.services.jobs.get(job.id)).toMatchObject({ parseState: 'done', title: FAKE_PARSED.title, match: null });
    expect(failed.map((f) => f.step)).toEqual(['rate']);
  });

  it('the start-up sweep reads waiting jobs at background priority, and a new save goes first', async () => {
    const order: string[] = [];
    const provider = new FakeAiProvider(
      (req) => {
        order.push(req.messages[1]!.content.split('\n').pop()!);
        return defaultReply(req);
      },
      { delayMs: 30 },
    );
    const app = await setup({ provider });
    const old = [save(app, pastedCapture('Old ad 1')), save(app, pastedCapture('Old ad 2')), save(app, pastedCapture('Old ad 3'))];
    await app.services.enrich.onIdle();
    // As if they were saved before the AI existed: pending, never read.
    for (const job of old) app.services.jobs.setParseState(job.id, 'pending');
    order.length = 0;
    expect(app.services.enrich.sweep()).toBe(3);
    save(app, pastedCapture('New ad'));
    await app.services.enrich.onIdle();
    expect(order[0]).toBe('Old ad 1'); // already running when the new one arrived
    expect(order[1]).toBe('New ad');
    for (const job of old) expect(app.services.jobs.get(job.id).parseState).toBe('done');
  });

  it('a linked second ad is read too, and fills only what is still empty', async () => {
    const provider = new FakeAiProvider((req) =>
      req.messages[1]!.content.includes('second ad') ? JSON.stringify({ ...FAKE_PARSED, title: 'Ignored', closingDate: '2026-12-01' }) : JSON.stringify({ ...FAKE_PARSED, closingDate: null }),
    );
    const app = await setup({ provider });
    const job = save(app, seekCapture('1', { jdText: 'first ad' }), { title: 'My title' });
    await app.services.enrich.onIdle();
    app.services.jobs.save({ capture: seekCapture('2', { jdText: 'second ad' }), decision: { linkTo: job.id } });
    await app.services.enrich.onIdle();
    expect(app.services.jobs.get(job.id)).toMatchObject({ title: 'My title', closingDate: '2026-12-01', parseState: 'done' });
  });

  it('an answer that never fits marks the job failed, for good', async () => {
    const app = await setup({ provider: new FakeAiProvider(() => 'not json at all') });
    const job = save(app);
    await app.services.enrich.onIdle();
    expect(app.services.jobs.get(job.id)).toMatchObject({
      parseState: 'failed',
      parseError: "The AI's answer didn't fit the expected format, even after a second try.",
    });
  });

  it('jobs waiting for the AI are read once it works again', async () => {
    let down = true;
    const provider = new FakeAiProvider((req) => (down ? new AiUnavailableError("Can't reach the AI.") : defaultReply(req)));
    const app = await setup({ provider });
    const waiting = [save(app, pastedCapture('Ad one')), save(app, pastedCapture('Ad two'))];
    await app.services.enrich.onIdle();
    for (const job of waiting) expect(app.services.jobs.get(job.id).parseState).toBe('pending');
    down = false;
    // Any task that works shows the AI is back: a new save, or Test connection.
    expect((await app.services.ai.test()).ok).toBe(true);
    await app.services.enrich.onIdle();
    for (const job of waiting) expect(app.services.jobs.get(job.id)).toMatchObject({ parseState: 'done', parseError: null });
  });

  it("the start-up sweep stops at the first \"can't reach the AI\", leaving the rest waiting", async () => {
    let down = false;
    const provider = new FakeAiProvider((req) => (down ? new AiUnavailableError("Can't reach the AI.") : defaultReply(req)));
    const app = await setup({ provider });
    const jobs = [save(app, pastedCapture('A')), save(app, pastedCapture('B')), save(app, pastedCapture('C'))];
    await app.services.enrich.onIdle();
    for (const job of jobs) app.services.jobs.setParseState(job.id, 'pending');
    down = true;
    provider.calls.length = 0;
    expect(app.services.enrich.sweep()).toBe(3);
    await app.services.enrich.onIdle();
    expect(provider.callsFor('parsed_job')).toHaveLength(1);
    for (const job of jobs) expect(app.services.jobs.get(job.id).parseState).toBe('pending');
  });

  it("every job waiting behind the first \"can't reach the AI\" says why too", async () => {
    let down = false;
    const provider = new FakeAiProvider((req) => (down ? new AiUnavailableError("Can't reach the AI at x.") : defaultReply(req)));
    const app = await setup({ provider });
    const jobs = [save(app, pastedCapture('A')), save(app, pastedCapture('B')), save(app, pastedCapture('C'))];
    await app.services.enrich.onIdle();
    for (const job of jobs) app.services.jobs.setParseState(job.id, 'pending');
    down = true;
    app.services.enrich.sweep();
    await app.services.enrich.onIdle();
    for (const job of jobs) expect(app.services.jobs.get(job.id)).toMatchObject({ parseState: 'pending', parseError: "Can't reach the AI at x." });
  });

  it("an ad the server refuses is marked failed with the server's message, and the others are still read", async () => {
    const refusal = 'The AI at x answered with an error (400): the prompt is longer than the context.';
    const provider = new FakeAiProvider((req) => (req.messages[1]!.content.includes('Huge ad') ? new AiRefusedError(refusal) : defaultReply(req)));
    const app = await setup({ provider });
    const jobs = [save(app, pastedCapture('Huge ad')), save(app, pastedCapture('B')), save(app, pastedCapture('C'))];
    await app.services.enrich.onIdle();
    for (const job of jobs) app.services.jobs.setParseState(job.id, 'pending');
    app.services.enrich.sweep();
    await app.services.enrich.onIdle();
    expect(app.services.jobs.get(jobs[0]!.id)).toMatchObject({ parseState: 'failed', parseError: refusal });
    for (const job of jobs.slice(1)) expect(app.services.jobs.get(job.id).parseState).toBe('done');
    // It isn't tried again after every good task.
    const tries = provider.callsFor('parsed_job').filter((c) => c.messages[1]!.content.includes('Huge ad')).length;
    expect(tries).toBe(2);
  });

  it('when the server refuses every ad the same way, the round stops and the jobs wait with the reason', async () => {
    let broken = false;
    const refusal = "The AI at x answered with an error (404): model 'default' not found";
    const provider = new FakeAiProvider((req) => (broken ? new AiRefusedError(refusal) : defaultReply(req)));
    const app = await setup({ provider });
    const jobs = [save(app, pastedCapture('A')), save(app, pastedCapture('B')), save(app, pastedCapture('C')), save(app, pastedCapture('D'))];
    await app.services.enrich.onIdle();
    for (const job of jobs) app.services.jobs.setParseState(job.id, 'pending');
    broken = true;
    provider.calls.length = 0;
    app.services.enrich.sweep();
    await app.services.enrich.onIdle();
    expect(provider.callsFor('parsed_job')).toHaveLength(2);
    for (const job of jobs) expect(app.services.jobs.get(job.id)).toMatchObject({ parseState: 'pending', parseError: refusal });
  });
});

