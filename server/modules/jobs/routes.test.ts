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
});
