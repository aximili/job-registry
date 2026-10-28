import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient } from './api-client.ts';

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fn = async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const text = body === undefined ? null : JSON.stringify(body);
    return new Response(text, { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fn as typeof fetch, calls };
}

const job = {
  id: 1,
  title: 'Senior Engineer',
  company: 'Atlassian',
  agency: null,
  location: 'Sydney NSW',
  workMode: 'hybrid',
  employmentType: 'full-time',
  salary: { min: null, max: null, currency: null, period: null, text: null },
  closingDate: null,
  summary: null,
  requirements: [],
  niceToHave: [],
  responsibilities: [],
  dateApplied: null,
  status: 'saved',
  adContact: null,
  fieldSources: {},
  parseState: 'none',
  parseError: null,
  matchVerdict: null,
  matchScore: null,
  match: null,
  archived: false,
  createdAt: '2026-10-28T03:15:00.000Z',
  updatedAt: '2026-10-28T03:15:00.000Z',
};

const capture = {
  sourceUrl: null,
  canonicalUrl: null,
  sourceSite: 'pasted' as const,
  externalId: null,
  jdText: 'An ad',
  capturedAt: '2026-10-28T03:15:00.000Z',
};

describe('api client', () => {
  it('saveJob POSTs JSON to /api/v1/jobs and returns the parsed body', async () => {
    const { fetch, calls } = fakeFetch(201, { result: 'created', job });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch });
    const res = await api.saveJob({ capture });
    expect(res).toEqual({ result: 'created', job });
    expect(calls[0]?.url).toBe('http://127.0.0.1:4777/api/v1/jobs');
    expect(calls[0]?.init.method).toBe('POST');
    expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ capture });
  });

  it('turns an error body into ApiError with code and status', async () => {
    const { fetch } = fakeFetch(404, { error: { code: 'not_found', message: 'Job 9 not found' } });
    const api = createApiClient({ baseUrl: '', fetch });
    const err = await api.getJob(9).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'not_found', status: 404, message: 'Job 9 not found' });
  });

  it('search encodes q and passes the abort signal', async () => {
    const { fetch, calls } = fakeFetch(200, { hits: [] });
    const api = createApiClient({ baseUrl: '', fetch });
    const controller = new AbortController();
    await api.search('AT&T', { signal: controller.signal });
    expect(calls[0]?.url).toBe('/api/v1/search?q=AT%26T');
    expect(calls[0]?.init.signal).toBe(controller.signal);
  });

  it('listJobs builds the query string from the given keys only', async () => {
    const { fetch, calls } = fakeFetch(200, []);
    const api = createApiClient({ baseUrl: '', fetch });
    await api.listJobs({ status: 'closed' });
    await api.listJobs();
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/jobs?status=closed', '/api/v1/jobs']);
  });

  it('throws ApiError internal "Unexpected response from the server." when the body does not match the schema', async () => {
    const { fetch } = fakeFetch(200, { nope: true });
    const api = createApiClient({ baseUrl: '', fetch });
    await expect(api.getJob(1)).rejects.toMatchObject({
      code: 'internal',
      message: 'Unexpected response from the server.',
    });
  });
});
