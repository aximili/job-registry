import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Capture, JobCard, Rating } from '../../../shared/contracts/index.ts';
import { FAKE_CARD_RATING, FAKE_RATING, FakeAiProvider } from '../../../tests/fakes/fake-ai-provider.ts';
import { createTestApp, freePort, type TestApp } from '../../../tests/helpers/test-app.ts';
import { cardKey, cardText } from './index.ts';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function setup(opts: { profile?: string; provider?: FakeAiProvider; now?: () => Date } = {}) {
  const provider = opts.provider ?? new FakeAiProvider();
  app = await createTestApp({ fakes: { ai: provider }, now: opts.now });
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

const NO_PROFILE = 'Add your master profile in Settings → Profile to get match ratings.';

const card = (over: Partial<JobCard> = {}): JobCard => ({
  canonicalUrl: 'https://www.seek.com.au/job/1',
  sourceSite: 'seek',
  externalId: '1',
  title: 'Senior Engineer',
  company: 'Atlassian',
  location: 'Sydney NSW',
  text: 'Build developer tools in TypeScript.',
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
      reason: 'Add your master profile in Settings → Profile to get match ratings.',
    });
    expect(provider.calls).toHaveLength(0);
    expect((await app.request('GET', '/api/v1/ratings/status')).body).toEqual({
      ready: false,
      detail: 'Add your master profile in Settings → Profile to get match ratings.',
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

  it.each([
    ['/api/v1/ratings', () => ({ capture: capture() })],
    ['/api/v1/ratings/card', () => ({ card: card() })],
  ])('closing the request to %s cancels a rating that is still running', async (path, body) => {
    const provider = new FakeAiProvider(undefined, { delayMs: 2000 });
    const port = await freePort();
    app = await createTestApp({ fakes: { ai: provider }, port });
    writeProfile('I write TypeScript.');
    await app.http.listen({ host: '127.0.0.1', port });
    const controller = new AbortController();
    const started = Date.now();
    const pending = fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify(body()),
      signal: controller.signal,
    }).catch(() => null);
    await new Promise((r) => setTimeout(r, 150));
    controller.abort();
    await pending;
    await app.services.ai.onIdle();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('ratings: job cards in a search list', () => {
  const PROFILE = 'I write TypeScript.';

  it('a card is its non-empty parts, one per line, and its key is its link and a hash of that text', () => {
    expect(cardText(card())).toBe('Senior Engineer\nAtlassian\nSydney NSW\nBuild developer tools in TypeScript.');
    expect(cardText(card({ company: null, location: '  ', text: '' }))).toBe('Senior Engineer');
    expect(cardKey(card())).toMatch(/^https:\/\/www\.seek\.com\.au\/job\/1#[0-9a-f]{16}$/);
    expect(cardKey(card({ text: 'Build developer tools in Go.' }))).not.toBe(cardKey(card()));
  });

  it('a card is rated once per profile', async () => {
    const { app, provider } = await setup({ profile: PROFILE });
    expect(await app.services.ratings.rateCard(card())).toEqual({ rating: FAKE_CARD_RATING, cached: false, reason: null });
    expect(await app.services.ratings.rateCard(card())).toEqual({ rating: FAKE_CARD_RATING, cached: true, reason: null });
    expect(provider.callsFor('card_rating')).toHaveLength(1);
    expect(provider.calls[0]!.messages.at(-1)!.content).toContain(cardText(card()));
    writeProfile('I write TypeScript and Go.');
    expect(await app.services.ratings.rateCard(card())).toEqual({ rating: FAKE_CARD_RATING, cached: false, reason: null });
    expect(provider.callsFor('card_rating')).toHaveLength(2);
  });

  it('a card with changed text is rated again', async () => {
    const { app, provider } = await setup({ profile: PROFILE });
    await app.services.ratings.rateCard(card());
    expect((await app.services.ratings.rateCard(card({ text: 'Build developer tools in Go.' }))).cached).toBe(false);
    expect((await app.services.ratings.rateCard(card())).cached).toBe(true);
    expect(provider.callsFor('card_rating')).toHaveLength(2);
  });

  it('no master profile: no AI call, and no card gets a mark', async () => {
    const { app, provider } = await setup();
    expect(await app.services.ratings.rateCard(card())).toEqual({ rating: null, cached: false, reason: NO_PROFILE });
    expect(app.services.ratings.lookupCards([card(), card({ canonicalUrl: 'https://www.seek.com.au/job/2' })])).toEqual({
      results: [null, null],
      reason: NO_PROFILE,
    });
    expect(provider.calls).toHaveLength(0);
  });

  it('lookup prefers a full rating, then a quick one, in the same order as the cards', async () => {
    const { app, provider } = await setup({ profile: PROFILE });
    await app.services.ratings.rate(seekAd);
    await app.services.ratings.rateCard(card());
    const quickOnly = card({ canonicalUrl: 'https://www.seek.com.au/job/2', externalId: '2' });
    await app.services.ratings.rateCard(quickOnly);
    // A full rating with nothing in its favour gives a mark with no reason.
    const noReasons = card({ canonicalUrl: 'https://www.seek.com.au/job/4', externalId: '4' });
    provider.reply = () => JSON.stringify({ ...FAKE_RATING, verdict: 'weak', score: 20, why: [] });
    await app.services.ratings.rate({ canonicalUrl: noReasons.canonicalUrl, jdText: 'We need COBOL.' });
    const unknown = card({ canonicalUrl: 'https://www.seek.com.au/job/3', externalId: '3' });

    expect(app.services.ratings.lookupCards([unknown, quickOnly, card(), noReasons])).toEqual({
      results: [
        null,
        { kind: 'quick', verdict: FAKE_CARD_RATING.verdict, score: FAKE_CARD_RATING.score, reason: FAKE_CARD_RATING.reason },
        { kind: 'full', verdict: FAKE_RATING.verdict, score: FAKE_RATING.score, reason: FAKE_RATING.why[0] },
        { kind: 'full', verdict: 'weak', score: 20, reason: null },
      ],
      reason: null,
    });
  });

  it('lookup uses the newest full rating for a link', async () => {
    let clock = new Date('2026-10-29T01:00:00.000Z');
    const { app, provider } = await setup({ profile: PROFILE, now: () => clock });
    await app.services.ratings.rate(seekAd);
    clock = new Date('2026-10-29T02:00:00.000Z');
    const newest: Rating = { ...FAKE_RATING, verdict: 'stretch', score: 45, why: ['A fuller read of the ad'] };
    provider.reply = () => JSON.stringify(newest);
    await app.services.ratings.rate({ ...seekAd, jdText: 'We need TypeScript. And Go, and much more.' });
    clock = new Date('2026-10-29T00:00:00.000Z');
    provider.reply = () => JSON.stringify({ ...FAKE_RATING, score: 10 });
    await app.services.ratings.rate({ ...seekAd, jdText: 'An older read, stored last.' });

    expect(app.services.ratings.lookupCards([card()]).results).toEqual([
      { kind: 'full', verdict: 'stretch', score: 45, reason: 'A fuller read of the ad' },
    ]);
  });

  it('lookup ignores ratings made with an older profile', async () => {
    const { app } = await setup({ profile: PROFILE });
    await app.services.ratings.rate(seekAd);
    await app.services.ratings.rateCard(card());
    expect(app.services.ratings.lookupCards([card()]).results[0]?.kind).toBe('full');
    writeProfile('I write TypeScript and Go.');
    expect(app.services.ratings.lookupCards([card()])).toEqual({ results: [null], reason: null });
  });

  it('a full rating for another link that starts the same is not used', async () => {
    const { app } = await setup({ profile: PROFILE });
    await app.services.ratings.rate({ canonicalUrl: 'https://www.seek.com.au/job/12', jdText: 'We need TypeScript.' });
    // A link can hold % and _, and each must match only itself.
    await app.services.ratings.rate({ canonicalUrl: 'https://example.com/jobs?id=7a', jdText: 'We need TypeScript.' });
    await app.services.ratings.rate({ canonicalUrl: 'https://example.com/jobs?id=100', jdText: 'We need TypeScript.' });

    const marks = app.services.ratings.lookupCards([
      card(),
      card({ canonicalUrl: 'https://example.com/jobs?id=7_' }),
      card({ canonicalUrl: 'https://example.com/jobs?id=1%' }),
      card({ canonicalUrl: 'https://www.seek.com.au/job/12' }),
    ]).results;
    expect(marks.map((m) => m?.kind ?? null)).toEqual([null, null, null, 'full']);
  });

  it('POST /ratings/card returns the quick rating, and POST /ratings/cards/lookup takes 1 to 100 cards', async () => {
    const { app } = await setup({ profile: PROFILE });
    const rated = await app.request('POST', '/api/v1/ratings/card', { card: card(), key: 'cards-tab-7' });
    expect(rated.status).toBe(200);
    expect(rated.body).toEqual({ rating: FAKE_CARD_RATING, cached: false, reason: null });

    const lookup = await app.request('POST', '/api/v1/ratings/cards/lookup', { cards: [card()] });
    expect(lookup.status).toBe(200);
    expect(lookup.body).toEqual({ results: [{ kind: 'quick', ...FAKE_CARD_RATING }], reason: null });

    const many = Array.from({ length: 101 }, (_, i) => card({ canonicalUrl: `https://www.seek.com.au/job/${i}` }));
    expect((await app.request('POST', '/api/v1/ratings/cards/lookup', { cards: many })).status).toBe(400);
    expect((await app.request('POST', '/api/v1/ratings/cards/lookup', { cards: many.slice(0, 100) })).status).toBe(200);
    expect((await app.request('POST', '/api/v1/ratings/cards/lookup', { cards: [] })).status).toBe(400);
  });
});

