import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../shared/api-client.ts';
import type { Capture, JobCard } from '../../shared/contracts/index.ts';
import { FAKE_CARD_RATING, FAKE_RATING, FakeAiProvider } from '../../tests/fakes/fake-ai-provider.ts';
import { FakeChrome } from '../../tests/fakes/fake-chrome.ts';
import { createTestApp, freePort, type TestApp } from '../../tests/helpers/test-app.ts';
import { createHandlers } from './handlers.ts';
import type { Request } from './messages.ts';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

const seek = (id: string, over: Partial<Capture> = {}): Capture => ({
  sourceUrl: `https://www.seek.com.au/job/${id}`,
  canonicalUrl: `https://www.seek.com.au/job/${id}`,
  sourceSite: 'seek',
  externalId: id,
  title: 'Senior Engineer',
  company: 'Atlassian',
  jdText: 'Senior Engineer\nAtlassian\n\nWe need TypeScript.',
  capturedAt: '2026-10-28T03:15:00.000Z',
  ...over,
});

// One job card from a Seek search list.
const card = (id: string, over: Partial<JobCard> = {}): JobCard => ({
  canonicalUrl: `https://www.seek.com.au/job/${id}`,
  sourceSite: 'seek',
  externalId: id,
  title: 'Senior Engineer',
  company: 'Atlassian',
  location: 'Sydney NSW',
  text: 'Build developer tools in TypeScript.',
  ...over,
});

const NO_PROFILE = 'Add your master profile in Settings → Profile to get match ratings.';

async function setup(opts: { provider?: FakeAiProvider; profile?: boolean } = {}) {
  const port = await freePort();
  app = await createTestApp({ port, fakes: { ai: opts.provider ?? new FakeAiProvider() } });
  await app.http.listen({ host: '127.0.0.1', port });
  if (opts.profile) {
    mkdirSync(join(app.root, 'profile'), { recursive: true });
    writeFileSync(join(app.root, 'profile', 'master-profile.md'), 'I write TypeScript.');
  }
  const chrome = new FakeChrome();
  // In a browser the extension's own origin is sent by itself; Node needs it set.
  const api = createApiClient({ baseUrl: `http://127.0.0.1:${port}`, headers: { origin: 'moz-extension://test-extension' } });
  const handle = createHandlers({ api: () => api, chrome, serverUrl: async () => `http://127.0.0.1:${port}` });
  return { app, api, chrome, handle, port };
}

describe('background handlers', () => {
  it('check marks a page you already saved with a tick on its tab', async () => {
    const { app, chrome, handle } = await setup();
    const fresh = await handle({ type: 'check', capture: seek('1') }, { tabId: 7 });
    expect(fresh).toEqual({ ok: true, data: { exact: null, candidates: [] } });
    expect(chrome.badges.get(7)).toBe('');
    app.services.jobs.save({ capture: seek('1'), decision: 'new' });
    const saved = await handle({ type: 'check', capture: seek('1') }, { tabId: 7 });
    expect(saved.ok && saved.data.exact?.title).toBe('Senior Engineer');
    expect(chrome.badges.get(7)).toBe('✓');
  });

  it('save creates the job, marked as saved from the extension, with your note', async () => {
    const { app, chrome, handle } = await setup();
    const res = await handle({ type: 'save', capture: seek('2'), status: 'applied', note: 'Applied through Seek.' }, { tabId: 3 });
    expect(res.ok && res.data.result).toBe('created');
    const job = res.ok && res.data.result === 'created' ? res.data.job : null;
    expect(job).toMatchObject({ status: 'applied', dateApplied: expect.any(String) });
    expect(app.services.jobs.listHistory(job!.id)[0]).toMatchObject({ toStatus: 'applied', source: 'extension' });
    expect(app.services.notes.listForJob(job!.id).map((n) => n.body)).toEqual(['Applied through Seek.']);
    expect(chrome.badges.get(3)).toBe('✓');
  });

  it('saving the same job again says it exists, and moves the status forward only', async () => {
    const { handle } = await setup();
    await handle({ type: 'save', capture: seek('3'), status: 'saved', note: '' }, { tabId: 1 });
    const again = await handle({ type: 'save', capture: seek('3'), status: 'applied', note: '' }, { tabId: 1 });
    expect(again.ok && again.data.result).toBe('exists');
    expect(again.ok && again.data.result === 'exists' && again.data.job.status).toBe('applied');
  });

  it('a likely duplicate asks "Same job?", and the decision is sent on', async () => {
    const { app, handle } = await setup();
    app.services.jobs.save({ capture: seek('4'), decision: 'new', fields: { title: 'Senior Engineer', company: 'Atlassian' } });
    const ask = await handle({ type: 'save', capture: seek('5'), status: 'saved', note: '' }, { tabId: 1 });
    expect(ask.ok && ask.data.result).toBe('needs_decision');
    const linked = await handle({ type: 'save', capture: seek('5'), status: 'saved', note: '', decision: 'new' }, { tabId: 1 });
    expect(linked.ok && linked.data.result).toBe('created');
  });

  it("a newer rating from the same tab cancels the older one, so the panel never shows a stale job's rating", async () => {
    const { handle } = await setup({ provider: new FakeAiProvider(undefined, { delayMs: 500 }), profile: true });
    const first = handle({ type: 'rate', capture: seek('6') }, { tabId: 9 });
    await new Promise((r) => setTimeout(r, 50));
    const second = handle({ type: 'rate', capture: seek('7') }, { tabId: 9 });
    expect(await first).toEqual({ ok: false, error: 'cancelled', offline: false });
    const done = await second;
    expect(done.ok && done.data.rating?.verdict).toBe('good');
    // Another tab isn't affected.
    const other = await handle({ type: 'rate', capture: seek('6') }, { tabId: 10 });
    expect(other.ok).toBe(true);
  });

  it("cards asks what's saved and what's rated for the same cards, at once, and puts the answers together", async () => {
    const { app, api, handle } = await setup({ profile: true });
    const res = app.services.jobs.save({ capture: seek('20'), decision: 'new' });
    const jobId = 'job' in res ? res.job.id : null;
    // Saving reads and rates the ad, so the saved job has a full rating too.
    await app.services.enrich.onIdle();
    await app.services.ratings.rateCard(card('21'));
    const checkMany = vi.spyOn(api, 'checkMany');
    const lookupCards = vi.spyOn(api, 'lookupCards');
    const cards = [card('20'), card('21'), card('22')];

    expect(await handle({ type: 'cards', cards }, { tabId: 7 })).toEqual({
      ok: true,
      data: {
        saved: [expect.objectContaining({ jobId, status: 'saved' }), null, null],
        marks: [
          { kind: 'full', verdict: FAKE_RATING.verdict, score: FAKE_RATING.score, reason: FAKE_RATING.why[0] },
          { kind: 'quick', ...FAKE_CARD_RATING },
          null,
        ],
        reason: null,
      },
    });
    const items = cards.map((c) => ({ canonicalUrl: c.canonicalUrl, sourceSite: c.sourceSite, externalId: c.externalId }));
    expect(checkMany).toHaveBeenCalledExactlyOnceWith({ items }, { signal: expect.any(AbortSignal) });
    expect(lookupCards).toHaveBeenCalledExactlyOnceWith({ cards }, { signal: expect.any(AbortSignal) });
  });

  it('cards with no cards answers at once, without asking the app', async () => {
    const { api, handle } = await setup();
    const checkMany = vi.spyOn(api, 'checkMany');
    const lookupCards = vi.spyOn(api, 'lookupCards');
    expect(await handle({ type: 'cards', cards: [] }, { tabId: 7 })).toEqual({ ok: true, data: { saved: [], marks: [], reason: null } });
    expect(checkMany).not.toHaveBeenCalled();
    expect(lookupCards).not.toHaveBeenCalled();
  });

  it('cards sends 100 cards at most, and passes on why no card has a mark', async () => {
    const { api, handle } = await setup();
    const checkMany = vi.spyOn(api, 'checkMany');
    const lookupCards = vi.spyOn(api, 'lookupCards');
    const cards = Array.from({ length: 101 }, (_, i) => card(String(i)));
    expect(await handle({ type: 'cards', cards }, { tabId: 7 })).toEqual({
      ok: true,
      data: { saved: Array(100).fill(null), marks: Array(100).fill(null), reason: NO_PROFILE },
    });
    expect(checkMany.mock.calls[0]![0].items).toHaveLength(100);
    expect(lookupCards.mock.calls[0]![0].cards).toEqual(cards.slice(0, 100));
  });

  it('rateCard rates one card, with a key of its own for the tab', async () => {
    const { api, handle } = await setup({ profile: true });
    const rateCard = vi.spyOn(api, 'rateCard');
    expect(await handle({ type: 'rateCard', card: card('30') }, { tabId: 7 })).toEqual({
      ok: true,
      data: { rating: FAKE_CARD_RATING, cached: false, reason: null },
    });
    expect(rateCard).toHaveBeenCalledExactlyOnceWith({ card: card('30'), key: 'cards-tab-7' }, { signal: expect.any(AbortSignal) });
  });

  it('a newer card rating from the same tab cancels the older one', async () => {
    const { handle } = await setup({ provider: new FakeAiProvider(undefined, { delayMs: 500 }), profile: true });
    const first = handle({ type: 'rateCard', card: card('31') }, { tabId: 7 });
    await new Promise((r) => setTimeout(r, 50));
    const second = handle({ type: 'rateCard', card: card('32') }, { tabId: 7 });
    expect(await first).toEqual({ ok: false, error: 'cancelled', offline: false });
    const done = await second;
    expect(done.ok && done.data.rating).toEqual(FAKE_CARD_RATING);
  });

  it("a card's rating and the open job's rating from the same tab don't cancel each other", async () => {
    const { handle } = await setup({ provider: new FakeAiProvider(undefined, { delayMs: 200 }), profile: true });
    const cardRated = { ok: true, data: { rating: FAKE_CARD_RATING, cached: false, reason: null } };
    const jobRated = { ok: true, data: { rating: FAKE_RATING, cached: false, reason: null } };
    const cardFirst = handle({ type: 'rateCard', card: card('33') }, { tabId: 7 });
    await new Promise((r) => setTimeout(r, 50));
    const jobSecond = handle({ type: 'rate', capture: seek('34') }, { tabId: 7 });
    expect(await cardFirst).toEqual(cardRated);
    expect(await jobSecond).toEqual(jobRated);

    const jobFirst = handle({ type: 'rate', capture: seek('35') }, { tabId: 7 });
    await new Promise((r) => setTimeout(r, 50));
    const cardSecond = handle({ type: 'rateCard', card: card('36') }, { tabId: 7 });
    expect(await jobFirst).toEqual(jobRated);
    expect(await cardSecond).toEqual(cardRated);
  });

  it('with the app not running, every request says so', async () => {
    const chrome = new FakeChrome();
    const port = await freePort();
    const api = createApiClient({ baseUrl: `http://127.0.0.1:${port}` });
    const handle = createHandlers({ api: () => api, chrome, serverUrl: async () => `http://127.0.0.1:${port}` });
    const requests: Request[] = [
      { type: 'check', capture: seek('8') },
      { type: 'rate', capture: seek('8') },
      { type: 'health' },
      { type: 'cards', cards: [card('8')] },
      { type: 'rateCard', card: card('8') },
    ];
    for (const req of requests) {
      const res = await handle(req, { tabId: 1 });
      expect(res).toMatchObject({ ok: false, offline: true });
    }
  });

  it("if you've taken away the extension's permission to reach this computer, it says so", async () => {
    const chrome = new FakeChrome();
    chrome.hostAccess = false;
    const port = await freePort();
    const api = createApiClient({ baseUrl: `http://127.0.0.1:${port}` });
    const handle = createHandlers({ api: () => api, chrome, serverUrl: async () => `http://127.0.0.1:${port}` });
    const requests: Request[] = [{ type: 'health' }, { type: 'cards', cards: [card('8')] }, { type: 'rateCard', card: card('8') }];
    for (const req of requests) {
      expect(await handle(req, { tabId: 1 })).toEqual({
        ok: false,
        error: "The extension isn't allowed to reach Job Registry on this computer. Open its options and press Allow access.",
        offline: false,
      });
    }
  });

  it("an app that's there but never answers gets a plain message, not an endless wait", async () => {
    const silent = createServer(() => {});
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()));
    const { port } = silent.address() as { port: number };
    const chrome = new FakeChrome();
    const api = createApiClient({ baseUrl: `http://127.0.0.1:${port}` });
    const handle = createHandlers({ api: () => api, chrome, serverUrl: async () => `http://127.0.0.1:${port}`, timeoutMs: 300 });
    const requests: Request[] = [{ type: 'check', capture: seek('11') }, { type: 'cards', cards: [card('11')] }];
    for (const req of requests) {
      const started = Date.now();
      expect(await handle(req, { tabId: 1 })).toEqual({
        ok: false,
        error: "Job Registry isn't answering. Try again in a moment.",
        offline: false,
      });
      expect(Date.now() - started).toBeLessThan(2000);
    }
    silent.close();
  });

  it('captureActiveTab reads the page in the active tab with the generic reader', async () => {
    const { chrome, handle } = await setup();
    chrome.activeTabId = 12;
    chrome.scriptResult = seek('9', { sourceSite: 'other', title: 'From the page' });
    const res = await handle({ type: 'captureActiveTab' }, { tabId: null });
    expect(res).toEqual({ ok: true, data: chrome.scriptResult });
    expect(chrome.injected).toEqual([{ tabId: 12, files: ['generic.js'] }]);
  });

  it('openJob opens the job in the dashboard', async () => {
    const { chrome, handle, port } = await setup();
    await handle({ type: 'openJob', jobId: 42 }, { tabId: 1 });
    expect(chrome.opened).toEqual([`http://127.0.0.1:${port}/jobs/42`]);
  });
});
