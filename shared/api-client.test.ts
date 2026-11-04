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
      fetch: streamingFetch([
        '{"kind":"waiting","by":"Claude – mine"}\n{"kind":"working","by":"Claude – mine"}\n{"kind":"alive"}\n',
        '{"kind":"text","te',
        'xt":"# Sam"}\n{"kind":"alive"}\n{"kind":"text","text":" Taylor"}\n',
        '{"kind":"done"}\n',
      ]),
    });
    const chunks = [];
    for await (const chunk of api.generateDocument(1, 'resume')) chunks.push(chunk);
    // Who's writing, then the text. An alive line only keeps the reply open: it isn't passed on.
    expect(chunks).toEqual([
      { kind: 'waiting', by: 'Claude – mine' },
      { kind: 'working', by: 'Claude – mine' },
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
            c.enqueue(new TextEncoder().encode('{"kind":"text","text":"# Sam"}\n{"kind":"alive"}\n'));
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

describe('generateDocument: with or without the brief', () => {
  it("sends brief and the brief on screen only when they're given, so the server's default ('skip') holds otherwise", async () => {
    const { fetch, calls } = fakeFetch(200, { kind: 'done' });
    const api = createApiClient({ baseUrl: 'http://x', fetch });
    for await (const _chunk of api.generateDocument(1, 'cover_letter', { brief: 'use', briefId: 3 })) {
      // one done line
    }
    for await (const _chunk of api.generateDocument(1, 'resume')) {
      // one done line
    }
    expect(calls.map((c) => JSON.parse(String(c.init.body)))).toEqual([{ kind: 'cover_letter', brief: 'use', briefId: 3 }, { kind: 'resume' }]);
  });
});

// A reply that arrives in these parts, as a stream.
function streamingFetch(parts: string[]) {
  return (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const part of parts) c.enqueue(new TextEncoder().encode(part));
          c.close();
        },
      }),
      { status: 200 },
    )) as unknown as typeof globalThis.fetch;
}

describe('the brief', () => {
  const brief = {
    id: 3,
    jobId: 1,
    by: 'Bonsai 2',
    createdAt: '2026-11-03T01:00:00.000Z',
    updatedAt: '2026-11-03T01:00:00.000Z',
    approvedAt: null,
    contact: { name: 'Alex', email: 'alex@example-recruit.com.au', recruiter: true, organisation: 'Example Recruit' },
    opening: { quote: "You'll help our engineers ship faster.", why: 'I cut build times by 30%.', inAd: true },
    needs: [{ need: 'TypeScript', stories: [{ title: 'Moving to TypeScript', text: 'I moved the web app to TypeScript.' }], chosen: 0, dropped: false }],
    gaps: [],
    questions: [{ question: 'Have you used Go?', why: 'The ad lists Go.', answer: null, skipped: false, addToProfile: false, addedAt: null, fromEarlier: false }],
  };

  it('reads the lines as the brief is made, ending with the brief', async () => {
    const parts = ['{"kind":"waiting","by":"Bonsai 2"}\n{"kind":"work', `ing","by":"Bonsai 2"}\n{"kind":"alive"}\n${JSON.stringify({ kind: 'done', brief })}\n`];
    const api = createApiClient({ baseUrl: 'http://x', fetch: streamingFetch(parts) });
    const got = [];
    for await (const line of api.makeBrief(1)) got.push(line);
    // An alive line only keeps the reply open: it isn't passed on.
    expect(got).toEqual([{ kind: 'waiting', by: 'Bonsai 2' }, { kind: 'working', by: 'Bonsai 2' }, { kind: 'done', brief }]);
  });

  it('a stream that just stops is an error, so a brief is never taken as made', async () => {
    const api = createApiClient({ baseUrl: 'http://x', fetch: streamingFetch(['{"kind":"waiting","by":"Bonsai 2"}\n{"kind":"alive"}\n']) });
    const run = async () => {
      for await (const _line of api.makeBrief(1)) {
        // waiting, then nothing
      }
    };
    await expect(run()).rejects.toThrow('The brief stopped before it was finished. Try again.');
  });

  it('gets, edits and adds answers at their addresses', async () => {
    const { fetch, calls } = fakeFetch(200, { brief });
    const api = createApiClient({ baseUrl: 'http://x', fetch });
    expect(await api.getBrief(1)).toEqual({ brief });
    const edit = fakeFetch(200, brief);
    await createApiClient({ baseUrl: 'http://x', fetch: edit.fetch }).editBrief(3, { contact: { name: 'Alex', recruiter: true } });
    const added = fakeFetch(200, { added: 2 });
    expect(await createApiClient({ baseUrl: 'http://x', fetch: added.fetch }).addAnswersToProfile(3)).toEqual({ added: 2 });
    expect(calls[0]!.url).toBe('http://x/api/v1/jobs/1/brief');
    expect([edit.calls[0]!.url, edit.calls[0]!.init.method, JSON.parse(String(edit.calls[0]!.init.body))]).toEqual([
      'http://x/api/v1/briefs/3',
      'PATCH',
      { contact: { name: 'Alex', recruiter: true } },
    ]);
    expect([added.calls[0]!.url, added.calls[0]!.init.method]).toEqual(['http://x/api/v1/briefs/3/answers-to-profile', 'POST']);
  });
});

describe('the prep plan', () => {
  const plan = {
    id: 4,
    jobId: 1,
    by: 'Bonsai 2',
    createdAt: '2026-11-03T01:00:00.000Z',
    // A topic whose steps were only links keeps none.
    learn: [{ topic: 'Go basics', why: 'The ad lists Go.', steps: [], hours: 4, afterwards: "I've learnt Go's basics." }],
    project: { title: 'A build-time dashboard', what: 'A small app.', touches: ['Go'], hours: 6, afterwards: 'I built a small tool.' },
    interview: [{ question: 'Tell us about a time you made developers faster.', story: 'Cutting build times by 30%.' }],
    ask: [],
    refresh: [],
  };

  it('reads the lines as the plan is made, ending with the plan', async () => {
    const parts = ['{"kind":"waiting","by":"Bonsai 2"}\n{"kind":"work', `ing","by":"Bonsai 2"}\n{"kind":"alive"}\n${JSON.stringify({ kind: 'done', plan })}\n`];
    const api = createApiClient({ baseUrl: 'http://x', fetch: streamingFetch(parts) });
    const got = [];
    for await (const line of api.makePrepPlan(1)) got.push(line);
    expect(got).toEqual([{ kind: 'waiting', by: 'Bonsai 2' }, { kind: 'working', by: 'Bonsai 2' }, { kind: 'done', plan }]);
  });

  it('a stream that just stops is an error, so a plan is never taken as made', async () => {
    const api = createApiClient({ baseUrl: 'http://x', fetch: streamingFetch(['{"kind":"waiting","by":"Bonsai 2"}\n{"kind":"alive"}\n']) });
    const run = async () => {
      for await (const _line of api.makePrepPlan(1)) {
        // waiting, then nothing
      }
    };
    await expect(run()).rejects.toThrow('The plan stopped before it was finished. Try again.');
  });

  it("gets the job's plans, and makes one, at their addresses", async () => {
    const { fetch, calls } = fakeFetch(200, { plans: [plan] });
    expect(await createApiClient({ baseUrl: 'http://x', fetch }).prepPlans(1)).toEqual({ plans: [plan] });
    expect([calls[0]!.url, calls[0]!.init.method]).toEqual(['http://x/api/v1/jobs/1/prep', 'GET']);
    const made = fakeFetch(200, { kind: 'done', plan });
    for await (const _line of createApiClient({ baseUrl: 'http://x', fetch: made.fetch }).makePrepPlan(1)) {
      // one done line
    }
    expect([made.calls[0]!.url, made.calls[0]!.init.method]).toEqual(['http://x/api/v1/jobs/1/prep', 'POST']);
  });
});

describe('profile files', () => {
  it('saves a file with the updatedAt the editor loaded, when given, so a file changed since is never saved over', async () => {
    const { fetch, calls } = fakeFetch(200, { name: 'master-profile', text: '# Sam Taylor', updatedAt: '2026-11-03T01:00:00.000Z' });
    const api = createApiClient({ baseUrl: 'http://x', fetch });
    await api.putProfileFile('master-profile', '# Sam Taylor', '2026-11-03T01:00:00.000Z');
    // A file that was missing when the editor opened.
    await api.putProfileFile('preferences', 'Sydney only.', null);
    await api.putProfileFile('master-profile', '# Sam Taylor');
    expect(calls.map((c) => [c.url, c.init.method, JSON.parse(String(c.init.body))])).toEqual([
      ['http://x/api/v1/profile/master-profile', 'PUT', { text: '# Sam Taylor', updatedAt: '2026-11-03T01:00:00.000Z' }],
      ['http://x/api/v1/profile/preferences', 'PUT', { text: 'Sydney only.', updatedAt: null }],
      ['http://x/api/v1/profile/master-profile', 'PUT', { text: '# Sam Taylor' }],
    ]);
  });
});

describe('api client: secrets', () => {
  it('sends the app password with PUT and reads back only whether it is set', async () => {
    const { fetch, calls } = fakeFetch(200, { emailPassword: true, aiKeys: [] });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch });
    expect(await api.updateSecrets({ emailPassword: 'abcdefghijklmnop' })).toEqual({ emailPassword: true, aiKeys: [] });
    expect(calls[0]!.url).toBe('http://127.0.0.1:4777/api/v1/settings/secrets');
    expect(calls[0]!.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ emailPassword: 'abcdefghijklmnop' });
    expect(await api.secretsStatus()).toEqual({ emailPassword: true, aiKeys: [] });
    expect(calls[1]!.init.method).toBe('GET');
  });
});

describe('api client: the AI section of a settings change', () => {
  it('is checked as you write it: the older one-AI shape does not compile', () => {
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch: fakeFetch(200, {}).fetch });
    // @ts-expect-error: a change sends the saved AIs and the one in use, not one AI's fields.
    const flat = () => api.updateSettings({ ai: { model: 'qwen3:8b' } });
    expect(typeof flat).toBe('function');
  });
});

describe('api client: switching the AI in use', () => {
  it('sends the id with PUT and reads back the settings', async () => {
    const { fetch, calls } = fakeFetch(200, {});
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch });
    expect((await api.useAi('bonsai-2')).ai.active).toBe('bonsai-2');
    expect(calls[0]!.url).toBe('http://127.0.0.1:4777/api/v1/settings/ai/active');
    expect(calls[0]!.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ id: 'bonsai-2' });
  });
});

describe('api client: picking the AI that writes your documents', () => {
  it('sends the id, or null for the AI in use, with PUT and reads back the settings', async () => {
    const { fetch, calls } = fakeFetch(200, { ai: { active: 'bonsai-2', writer: 'bonsai-2', saved: [{ id: 'bonsai-2', name: 'Bonsai 2' }] } });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch });
    expect((await api.useWriter('bonsai-2')).ai.writer).toBe('bonsai-2');
    await api.useWriter(null);
    expect(calls.map((c) => [c.init.method, c.url, JSON.parse(String(c.init.body))])).toEqual([
      ['PUT', 'http://127.0.0.1:4777/api/v1/settings/ai/writer', { id: 'bonsai-2' }],
      ['PUT', 'http://127.0.0.1:4777/api/v1/settings/ai/writer', { id: null }],
    ]);
  });

  it('asks the browser to finish the request even if the page closes', async () => {
    const { fetch, calls } = fakeFetch(200, { ai: { active: 'bonsai-2', writer: null, saved: [{ id: 'bonsai-2', name: 'Bonsai 2' }] } });
    const api = createApiClient({ baseUrl: '', fetch });
    await api.useWriter(null);
    expect(calls[0]!.init.keepalive).toBe(true);
    // Other requests don't.
    await api.useAi('bonsai-2');
    expect(calls[1]!.init.keepalive).toBeUndefined();
  });
});

describe('api client: starter guides', () => {
  it("starters GETs each guide's state", async () => {
    const states = [
      { name: 'resume-guide', state: 'same', diff: null },
      { name: 'cover-letter-guide', state: 'newer', diff: [{ kind: 'removed', text: 'Mine.' }, { kind: 'added', text: 'Keep it short.' }] },
    ];
    const { fetch, calls } = fakeFetch(200, states);
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch });
    expect(await api.starters()).toEqual(states);
    expect([calls[0]!.init.method, calls[0]!.url]).toEqual(['GET', 'http://127.0.0.1:4777/api/v1/profile/starters']);
  });

  it('starterAction POSTs the action, and reads back the guide (use) or its state (keep)', async () => {
    const file = { name: 'cover-letter-guide', text: '# Cover letters', updatedAt: '2026-11-03T03:15:00.000Z' };
    const used = fakeFetch(200, file);
    expect(await createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch: used.fetch }).starterAction('cover-letter-guide', 'use')).toEqual(file);
    const status = { name: 'cover-letter-guide', state: 'yours', diff: null };
    const kept = fakeFetch(200, status);
    expect(await createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch: kept.fetch }).starterAction('cover-letter-guide', 'keep')).toEqual(status);
    expect([...used.calls, ...kept.calls].map((c) => [c.init.method, c.url, JSON.parse(String(c.init.body))])).toEqual([
      ['POST', 'http://127.0.0.1:4777/api/v1/profile/cover-letter-guide/starter', { action: 'use' }],
      ['POST', 'http://127.0.0.1:4777/api/v1/profile/cover-letter-guide/starter', { action: 'keep' }],
    ]);
  });
});

describe('api client: testing any AI, and its model list', () => {
  it('checkAi and aiModels POST the AI and the key you typed', async () => {
    const { fetch, calls } = fakeFetch(200, { ok: true, detail: 'Connected.', models: ['m'], replyMs: 5 });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:4777', fetch });
    const ai = { id: 'claude-mine', name: 'Claude – mine', preset: 'anthropic' as const, baseUrl: 'https://api.anthropic.com/v1' };
    expect(await api.checkAi({ ai, key: 'sk-typed' })).toEqual({ ok: true, detail: 'Connected.', models: ['m'], replyMs: 5 });
    expect(await api.aiModels({ ai })).toEqual({ ok: true, models: ['m'], detail: 'Connected.' });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['POST', 'http://127.0.0.1:4777/api/v1/ai/check'],
      ['POST', 'http://127.0.0.1:4777/api/v1/ai/models'],
    ]);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ ai, key: 'sk-typed' });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ ai });
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
