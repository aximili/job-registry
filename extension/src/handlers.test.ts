import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../../shared/api-client.ts';
import type { Capture } from '../../shared/contracts/index.ts';
import { FakeAiProvider } from '../../tests/fakes/fake-ai-provider.ts';
import { FakeChrome } from '../../tests/fakes/fake-chrome.ts';
import { createTestApp, freePort, type TestApp } from '../../tests/helpers/test-app.ts';
import { createHandlers } from './handlers.ts';

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
  return { app, chrome, handle, port };
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

  it('with the app not running, every request says so', async () => {
    const chrome = new FakeChrome();
    const port = await freePort();
    const api = createApiClient({ baseUrl: `http://127.0.0.1:${port}` });
    const handle = createHandlers({ api: () => api, chrome, serverUrl: async () => `http://127.0.0.1:${port}` });
    for (const req of [{ type: 'check', capture: seek('8') }, { type: 'rate', capture: seek('8') }, { type: 'health' }] as const) {
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
    expect(await handle({ type: 'health' }, { tabId: 1 })).toEqual({
      ok: false,
      error: "The extension isn't allowed to reach Job Registry on this computer. Open its options and press Allow access.",
      offline: false,
    });
  });

  it("an app that's there but never answers gets a plain message, not an endless wait", async () => {
    const silent = createServer(() => {});
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()));
    const { port } = silent.address() as { port: number };
    const chrome = new FakeChrome();
    const api = createApiClient({ baseUrl: `http://127.0.0.1:${port}` });
    const handle = createHandlers({ api: () => api, chrome, serverUrl: async () => `http://127.0.0.1:${port}`, timeoutMs: 300 });
    const started = Date.now();
    expect(await handle({ type: 'check', capture: seek('11') }, { tabId: 1 })).toEqual({
      ok: false,
      error: "Job Registry isn't answering. Try again in a moment.",
      offline: false,
    });
    expect(Date.now() - started).toBeLessThan(2000);
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
