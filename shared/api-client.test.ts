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
  followUpOn: null,
  followUpNote: null,
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

describe('generateDocument', () => {
  function streamingFetch(parts: string[], status = 200) {
    const fn = async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
          controller.close();
        },
      });
      return new Response(body, { status, headers: { 'content-type': 'application/x-ndjson' } });
    };
    return fn as unknown as typeof fetch;
  }

  it('reads each line as it arrives, even when a line is split across chunks', async () => {
    const api = createApiClient({
      baseUrl: 'http://x',
      fetch: streamingFetch(['{"kind":"text","te', 'xt":"# Sam"}\n{"kind":"text","text":" Taylor"}\n', '{"kind":"done"}\n']),
    });
    const chunks = [];
    for await (const chunk of api.generateDocument(1, 'resume')) chunks.push(chunk);
    expect(chunks).toEqual([
      { kind: 'text', text: '# Sam' },
      { kind: 'text', text: ' Taylor' },
      { kind: 'done' },
    ]);
  });

  it("an error before the stream starts is an ApiError with the server's message", async () => {
    const { fetch } = fakeFetch(400, { error: { code: 'validation', message: 'Add your master profile first: Settings → Profile.' } });
    const api = createApiClient({ baseUrl: 'http://x', fetch });
    const run = async () => {
      for await (const _chunk of api.generateDocument(1, 'resume')) {
        // nothing arrives
      }
    };
    await expect(run()).rejects.toEqual(new ApiError('validation', 400, 'Add your master profile first: Settings → Profile.'));
  });

  it('a line that is not a chunk is an error, not silently skipped', async () => {
    const api = createApiClient({ baseUrl: 'http://x', fetch: streamingFetch(['{"kind":"poem"}\n']) });
    const run = async () => {
      for await (const _chunk of api.generateDocument(1, 'resume')) {
        // nothing valid arrives
      }
    };
    await expect(run()).rejects.toThrow('Unexpected response from the server.');
  });
});

describe('generateDocument: a stream that just stops', () => {
  it('is an error, so a cut-off draft never looks finished', async () => {
    const fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"kind":"text","text":"# Sam"}\n'));
            c.close();
          },
        }),
        { status: 200 },
      )) as unknown as typeof globalThis.fetch;
    const api = createApiClient({ baseUrl: 'http://x', fetch });
    const chunks: unknown[] = [];
    const run = async () => {
      for await (const chunk of api.generateDocument(1, 'resume')) chunks.push(chunk);
    };
    await expect(run()).rejects.toThrow('The AI stopped before the draft was finished. The text so far is still here. Try again.');
    expect(chunks).toEqual([{ kind: 'text', text: '# Sam' }]);
  });
});

describe('api client: secrets', () => {
  it('sends the app password with PUT and reads back only whether it is set', async () => {
    const { fetch, calls } = fakeFetch(200, { emailPassword: true });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch });
    expect(await api.updateSecrets({ emailPassword: 'abcdefghijklmnop' })).toEqual({ emailPassword: true });
    expect(calls[0]!.url).toBe('http://127.0.0.1:4777/api/v1/settings/secrets');
    expect(calls[0]!.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ emailPassword: 'abcdefghijklmnop' });
    expect(await api.secretsStatus()).toEqual({ emailPassword: true });
    expect(calls[1]!.init.method).toBe('GET');
  });
});

describe('api client: follow-ups', () => {
  it('sets a follow-up with PUT', async () => {
    const { fetch, calls } = fakeFetch(200, { ...job, followUpOn: '2026-11-05', followUpNote: 'Chase' });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch });
    expect((await api.setFollowUp(1, { on: '2026-11-05', note: 'Chase' })).followUpOn).toBe('2026-11-05');
    expect(calls[0]!.url).toBe('http://127.0.0.1:4777/api/v1/jobs/1/follow-up');
    expect(calls[0]!.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ on: '2026-11-05', note: 'Chase' });
  });
});

describe('api client: job cards', () => {
  const card = {
    canonicalUrl: 'https://www.seek.com.au/job/1',
    sourceSite: 'seek' as const,
    externalId: '1',
    title: 'Senior Engineer',
    company: null,
    location: 'Sydney NSW',
    text: 'Build developer tools.',
  };

  it('rateCard and lookupCards POST to their routes and pass the abort signal', async () => {
    const rating = { verdict: 'good', score: 68, reason: 'Your TypeScript work fits the role.' };
    const { fetch, calls } = fakeFetch(200, { rating, cached: false, reason: null });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch });
    const controller = new AbortController();
    expect(await api.rateCard({ card, key: 'cards-tab-7' }, { signal: controller.signal })).toEqual({ rating, cached: false, reason: null });
    expect(calls[0]!.url).toBe('http://127.0.0.1:4777/api/v1/ratings/card');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ card, key: 'cards-tab-7' });
    expect(calls[0]!.init.signal).toBe(controller.signal);

    const marks = fakeFetch(200, { results: [{ kind: 'quick', ...rating }, null], reason: null });
    const lookup = createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch: marks.fetch });
    expect(await lookup.lookupCards({ cards: [card, card] }, { signal: controller.signal })).toEqual({
      results: [{ kind: 'quick', ...rating }, null],
      reason: null,
    });
    expect(marks.calls[0]!.url).toBe('http://127.0.0.1:4777/api/v1/ratings/cards/lookup');
    expect(marks.calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(marks.calls[0]!.init.body))).toEqual({ cards: [card, card] });
    expect(marks.calls[0]!.init.signal).toBe(controller.signal);
  });

  it('checkMany POSTs to /jobs/check-many and passes the abort signal', async () => {
    const saved = { jobId: 1, title: 'Senior Engineer', company: 'Atlassian', status: 'saved', dateApplied: null };
    const { fetch, calls } = fakeFetch(200, { results: [saved, null] });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch });
    const controller = new AbortController();
    const items = [
      { canonicalUrl: 'https://www.seek.com.au/job/1', sourceSite: 'seek' as const, externalId: '1' },
      { canonicalUrl: 'https://www.seek.com.au/job/2', sourceSite: 'seek' as const, externalId: '2' },
    ];
    expect(await api.checkMany({ items }, { signal: controller.signal })).toEqual({ results: [saved, null] });
    expect(calls[0]!.url).toBe('http://127.0.0.1:4777/api/v1/jobs/check-many');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ items });
    expect(calls[0]!.init.signal).toBe(controller.signal);
  });
});
