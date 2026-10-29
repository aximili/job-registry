import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pastedCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp();
});
afterEach(async () => {
  await app.cleanup();
});

describe('jobs routes', () => {
  it('POST /jobs creates a job with 201, and GET /jobs lists it', async () => {
    const res = await app.request('POST', '/api/v1/jobs', { capture: pastedCapture(), fields: { title: 'Engineer' } });
    expect(res.status).toBe(201);
    expect(res.body.result).toBe('created');
    const list = await app.request('GET', '/api/v1/jobs?status=open');
    expect(list.body.map((j: { title: string }) => j.title)).toEqual(['Engineer']);
  });

  it('PATCH /jobs/:id edits and GET /jobs/:id reads', async () => {
    const created = await app.request('POST', '/api/v1/jobs', { capture: pastedCapture() });
    const id = created.body.job.id;
    expect((await app.request('PATCH', `/api/v1/jobs/${id}`, { company: 'Xero' })).body.company).toBe('Xero');
    expect((await app.request('GET', `/api/v1/jobs/${id}`)).body.company).toBe('Xero');
  });

  it('POST /jobs/:id/status with an unknown status is a 400', async () => {
    const created = await app.request('POST', '/api/v1/jobs', { capture: pastedCapture() });
    const res = await app.request('POST', `/api/v1/jobs/${created.body.job.id}/status`, { status: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Unknown status 'nope'.");
  });

  it('GET /jobs/999 is a 404', async () => {
    const res = await app.request('GET', '/api/v1/jobs/999');
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: 'not_found', message: 'Job 999 not found' });
  });
});

describe('duplicate routes', () => {
  it('POST /jobs/check, POST /jobs/:id/postings and GET /postings/lookup', async () => {
    const created = await app.request('POST', '/api/v1/jobs', {
      capture: pastedCapture(),
      fields: { title: 'Senior Engineer', company: 'Atlassian' },
    });
    const id = created.body.job.id;
    const check = await app.request('POST', '/api/v1/jobs/check', {
      canonicalUrl: null,
      sourceSite: 'pasted',
      externalId: null,
      title: 'Senior Engineer',
      company: 'Atlassian Pty Ltd',
    });
    expect(check.body.candidates[0].jobId).toBe(id);

    const seek = {
      ...pastedCapture(),
      sourceSite: 'seek',
      canonicalUrl: 'https://www.seek.com.au/job/9',
      externalId: '9',
      sourceUrl: 'https://www.seek.com.au/job/9',
    };
    expect((await app.request('POST', `/api/v1/jobs/${id}/postings`, { capture: seek })).status).toBe(200);
    const lookup = await app.request('GET', `/api/v1/postings/lookup?url=${encodeURIComponent('https://www.seek.com.au/job/9?ref=x')}`);
    expect(lookup.body.match.jobId).toBe(id);
  });

  it('POST /jobs/check-many takes 1 to 100 items and answers each in order', async () => {
    const seek = (id: number) => ({ canonicalUrl: `https://www.seek.com.au/job/${id}`, sourceSite: 'seek', externalId: String(id) });
    const created = await app.request('POST', '/api/v1/jobs', {
      capture: { ...pastedCapture(), ...seek(5), sourceUrl: 'https://www.seek.com.au/job/5' },
    });
    const items = Array.from({ length: 100 }, (_, i) => seek(i + 1));
    const ok = await app.request('POST', '/api/v1/jobs/check-many', { items });
    expect(ok.status).toBe(200);
    expect(ok.body.results).toHaveLength(100);
    expect(ok.body.results[4].jobId).toBe(created.body.job.id);
    expect(ok.body.results.filter((r: unknown) => r !== null)).toHaveLength(1);

    expect((await app.request('POST', '/api/v1/jobs/check-many', { items: [...items, seek(101)] })).status).toBe(400);
    expect((await app.request('POST', '/api/v1/jobs/check-many', { items: [] })).status).toBe(400);
  });

  it('PUT /jobs/:id/follow-up sets one, refuses a bad date, and GET /jobs/follow-ups lists it', async () => {
    const created = await app.request('POST', '/api/v1/jobs', { capture: pastedCapture(), fields: { title: 'Engineer' } });
    const id = created.body.job.id;
    const bad = await app.request('PUT', `/api/v1/jobs/${id}/follow-up`, { on: '5/11/2026' });
    expect(bad.status).toBe(400);
    const set = await app.request('PUT', `/api/v1/jobs/${id}/follow-up`, { on: '2000-01-01', note: 'Chase' });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ followUpOn: '2000-01-01', followUpNote: 'Chase' });
    const list = await app.request('GET', '/api/v1/jobs/follow-ups');
    expect(list.status).toBe(200);
    expect(list.body.due.map((j: { id: number }) => j.id)).toEqual([id]);
    expect(list.body.soon).toEqual([]);
    expect(list.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("PATCH /jobs/:id can't set a follow-up", async () => {
    const created = await app.request('POST', '/api/v1/jobs', { capture: pastedCapture() });
    const id = created.body.job.id;
    await app.request('PATCH', `/api/v1/jobs/${id}`, { followUpOn: '2026-11-05', company: 'Xero' });
    expect((await app.request('GET', `/api/v1/jobs/${id}`)).body).toMatchObject({ company: 'Xero', followUpOn: null });
  });
});
