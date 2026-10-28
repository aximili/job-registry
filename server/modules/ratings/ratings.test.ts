import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Capture } from '../../../shared/contracts/index.ts';
import { FAKE_RATING, FakeAiProvider } from '../../../tests/fakes/fake-ai-provider.ts';
import { createTestApp, freePort, type TestApp } from '../../../tests/helpers/test-app.ts';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function setup(opts: { profile?: string; provider?: FakeAiProvider } = {}) {
  const provider = opts.provider ?? new FakeAiProvider();
  app = await createTestApp({ fakes: { ai: provider } });
  if (opts.profile !== undefined) writeProfile(opts.profile);
  return { app, provider };
}

function writeProfile(text: string, name = 'master-profile.md') {
  const dir = join(app!.root, 'profile');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), text);
}

const seekAd = { canonicalUrl: 'https://www.seek.com.au/job/1', jdText: 'We need TypeScript.' };
const capture = (over: Partial<Capture> = {}): Capture => ({
  sourceUrl: 'https://www.seek.com.au/job/1',
  canonicalUrl: 'https://www.seek.com.au/job/1',
  sourceSite: 'seek',
  externalId: '1',
  jdText: 'We need TypeScript.',
  capturedAt: '2026-10-28T03:15:00.000Z',
  ...over,
});

describe('ratings', () => {
  it('rates once, then answers from the cache for the same ad and profile', async () => {
    const { app, provider } = await setup({ profile: 'I write TypeScript.' });
    expect(await app.services.ratings.rate(seekAd)).toEqual({ rating: FAKE_RATING, cached: false, reason: null });
    expect(await app.services.ratings.rate(seekAd)).toEqual({ rating: FAKE_RATING, cached: true, reason: null });
    expect(provider.callsFor('rating')).toHaveLength(1);
  });

  it('a changed profile means a fresh rating', async () => {
    const { app, provider } = await setup({ profile: 'I write TypeScript.' });
    await app.services.ratings.rate(seekAd);
    writeProfile('Salary floor $150k', 'preferences.md');
    expect((await app.services.ratings.rate(seekAd)).cached).toBe(false);
    expect(provider.callsFor('rating')).toHaveLength(2);
  });

  it('force skips the cache but still stores the new rating', async () => {
    const { app, provider } = await setup({ profile: 'I write TypeScript.' });
    await app.services.ratings.rate(seekAd);
    expect((await app.services.ratings.rate(seekAd, { force: true })).cached).toBe(false);
    expect((await app.services.ratings.rate(seekAd)).cached).toBe(true);
    expect(provider.callsFor('rating')).toHaveLength(2);
  });

  it('the same link with different ad text is rated afresh, so an earlier or partial read never sticks', async () => {
    const { app, provider } = await setup({ profile: 'I write TypeScript.' });
    await app.services.ratings.rate(seekAd);
    expect((await app.services.ratings.rate({ ...seekAd, jdText: 'We need TypeScript. And Go, and much more.' })).cached).toBe(false);
    expect((await app.services.ratings.rate(seekAd)).cached).toBe(true);
    expect(provider.callsFor('rating')).toHaveLength(2);
  });

  it('pasted ads are cached by their text', async () => {
    const { app, provider } = await setup({ profile: 'I write TypeScript.' });
    await app.services.ratings.rate({ canonicalUrl: null, jdText: 'A pasted ad.' });
    expect((await app.services.ratings.rate({ canonicalUrl: null, jdText: 'A pasted ad.' })).cached).toBe(true);
    expect((await app.services.ratings.rate({ canonicalUrl: null, jdText: 'Another pasted ad.' })).cached).toBe(false);
    expect(provider.callsFor('rating')).toHaveLength(2);
  });

  it('with no master profile it says how to add one and never calls the AI', async () => {
    const { app, provider } = await setup();
    expect(await app.services.ratings.rate(seekAd)).toEqual({
      rating: null,
      cached: false,
      reason: 'Add your master profile as profile/master-profile.md to get match ratings.',
    });
    expect(provider.calls).toHaveLength(0);
    expect((await app.request('GET', '/api/v1/ratings/status')).body).toEqual({
      ready: false,
      detail: 'Add your master profile as profile/master-profile.md to get match ratings.',
    });
    writeProfile('Me');
    expect(app.services.ratings.status()).toEqual({ ready: true, detail: 'Ratings use profile/master-profile.md.' });
  });

  it('POST /ratings returns the rating and whether it came from the cache', async () => {
    const { app } = await setup({ profile: 'I write TypeScript.' });
    const first = await app.request('POST', '/api/v1/ratings', { capture: capture() });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ rating: FAKE_RATING, cached: false, reason: null });
    expect((await app.request('POST', '/api/v1/ratings', { capture: capture() })).body.cached).toBe(true);
  });

  it('a newer rating with the same key cancels one that is still waiting', async () => {
    const provider = new FakeAiProvider(undefined, { delayMs: 200 });
    const { app } = await setup({ profile: 'I write TypeScript.', provider });
    const a = app.services.ratings.rate({ canonicalUrl: 'https://www.seek.com.au/job/1', jdText: 'A' }, { key: 'tab-7' });
    const b = app.services.ratings.rate({ canonicalUrl: 'https://www.seek.com.au/job/2', jdText: 'B' }, { key: 'tab-7' });
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    expect((await b).rating).toEqual(FAKE_RATING);
  });

  it('closing the request cancels a rating that is still running', async () => {
    const provider = new FakeAiProvider(undefined, { delayMs: 2000 });
    const port = await freePort();
    app = await createTestApp({ fakes: { ai: provider }, port });
    writeProfile('I write TypeScript.');
    await app.http.listen({ host: '127.0.0.1', port });
    const controller = new AbortController();
    const started = Date.now();
    const pending = fetch(`http://127.0.0.1:${port}/api/v1/ratings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ capture: capture() }),
      signal: controller.signal,
    }).catch(() => null);
    await new Promise((r) => setTimeout(r, 150));
    controller.abort();
    await pending;
    await app.services.ai.onIdle();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

