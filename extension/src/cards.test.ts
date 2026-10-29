import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardMark, ExactMatch, Rating } from '../../shared/contracts/index.ts';
import { watchCards } from './cards.ts';
import type { ask, Request } from './messages.ts';
import type { FoundCard, SiteExtractor } from './sites/index.ts';

// Open the marks' shadow roots, as the browser tests' build does, so these
// tests can read what each mark says.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__PANEL_SHADOW__ = 'open';
});

const link = (id: string) => `https://www.seek.com.au/job/${id}`;

// A tiny search list: each <li data-id> is a card, with its title in an <h3>.
const site: SiteExtractor = {
  id: 'seek',
  matches: () => true,
  currentJobId: () => null,
  extract: () => null,
  readCards: (doc) =>
    Array.from(doc.querySelectorAll('li[data-id]'), (element): FoundCard => {
      const id = element.getAttribute('data-id')!;
      const anchor = element.querySelector('h3')!;
      return {
        element,
        anchor,
        card: { canonicalUrl: link(id), sourceSite: 'seek', externalId: id, title: anchor.textContent ?? '', company: 'Acme', location: null, text: '' },
      };
    }),
};

const APPLIED: ExactMatch = { jobId: 7, title: 'Developer', company: 'Acme', status: 'applied', dateApplied: '2026-10-12' };
const STRETCH: CardMark = { kind: 'quick', verdict: 'stretch', score: 45, reason: 'Some of it fits.' };
const GOOD = { ok: true, data: { rating: { verdict: 'good', score: 68, reason: 'Your React work fits.' }, cached: false, reason: null } };
const FULL: Rating = { verdict: 'strong', score: 84, why: ['You have led a team like this one.'], whyNot: [], dealBreakers: [], salaryNote: null };
const NO_PROFILE = 'Add your master profile in Settings → Profile to get match ratings.';
const OFFLINE = { ok: false, error: "Job Registry isn't running.", offline: true };

let href: string;
let doc: Document;
let on: boolean;
let shown: boolean;
let watcher: ReturnType<typeof watchCards> | null;
// What the app already knows, by job id, and why no card can get a mark.
let saved: Record<string, ExactMatch>;
let known: Record<string, CardMark>;
let reason: string | null;
// What the fake background was asked. A card rating waits until the test answers it.
let sent: Request[];
let waiting: ((reply: unknown) => void)[];
let withAi: number;
let most: number;

function fakeAsk(req: Request): Promise<unknown> {
  sent.push(req);
  if (req.type === 'cards') {
    const ids = req.cards.map((c) => c.externalId ?? '');
    return Promise.resolve({
      ok: true,
      data: { saved: ids.map((id) => saved[id] ?? null), marks: ids.map((id) => known[id] ?? null), reason },
    });
  }
  if (req.type === 'rateCard') {
    withAi++;
    most = Math.max(most, withAi);
    return new Promise((resolve) =>
      waiting.push((reply) => {
        withAi--;
        resolve(reply);
      }),
    );
  }
  throw new Error(`Unexpected request: ${req.type}`);
}

function start(): void {
  watcher = watchCards({
    doc,
    location: () => new URL(href),
    extractor: () => site,
    ask: fakeAsk as unknown as typeof ask,
    enabled: async () => on,
    visible: () => shown,
  });
}

// Answer the card rating that's with the AI.
async function answer(reply: unknown): Promise<void> {
  const next = waiting.shift();
  if (!next) throw new Error('No card rating is waiting.');
  next(reply);
  await vi.advanceTimersByTimeAsync(0);
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

const cardHtml = (id: string) => `<li data-id="${id}"><h3>Job ${id}</h3><p>Acme</p></li>`;
const showList = (ids: string[]) => {
  doc.querySelector('ul')!.innerHTML = ids.map(cardHtml).join('');
};
const addCards = (ids: string[]) => {
  doc.querySelector('ul')!.insertAdjacentHTML('beforeend', ids.map(cardHtml).join(''));
};
const cardEl = (id: string) => doc.querySelector(`li[data-id="${id}"]`)!;

// What each mark on a card says ("dead" for a copy with no shadow root).
const marksOn = (id: string) =>
  Array.from(cardEl(id).querySelectorAll('[data-job-registry-mark]'), (host) => host.shadowRoot?.querySelector('.mark')?.textContent ?? 'dead');
const tipOn = (id: string) => cardEl(id).querySelector('[data-job-registry-mark]')?.shadowRoot?.querySelector('.mark')?.getAttribute('title') ?? null;
const allMarks = () => doc.querySelectorAll('[data-job-registry-mark]').length;
const looked = () => sent.flatMap((r) => (r.type === 'cards' ? [r.cards.map((c) => c.externalId)] : []));
const rated = () => sent.flatMap((r) => (r.type === 'rateCard' ? [r.card.externalId] : []));

// Where a card is on screen (the window is 800 pixels tall).
function place(id: string, top: number): void {
  const el = cardEl(id) as unknown as { getBoundingClientRect: () => DOMRect };
  el.getBoundingClientRect = () => ({ top, bottom: top + 120, height: 120, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T03:00:00Z'));
  href = 'https://www.seek.com.au/developer-jobs?where=Sydney';
  doc = parseHTML('<!doctype html><html><body><ul></ul></body></html>').document as unknown as Document;
  (doc.defaultView as unknown as { innerHeight: number }).innerHeight = 800;
  on = true;
  shown = true;
  watcher = null;
  saved = {};
  known = {};
  reason = null;
  sent = [];
  waiting = [];
  withAi = 0;
  most = 0;
});
afterEach(() => {
  watcher?.stop();
  vi.useRealTimers();
});

describe('card marks on a search list', () => {
  it('known cards are drawn at once, then the rest are rated one at a time in page order', async () => {
    saved = { '1': APPLIED };
    known = { '2': STRETCH };
    showList(['1', '2', '3', '4']);
    start();
    await settle();
    expect(looked()).toEqual([['1', '2', '3', '4']]);
    expect(marksOn('1')).toEqual(['Saved · Applied 12 Oct']);
    expect(marksOn('2')).toEqual(['Stretch 45 · quick']);
    expect(marksOn('3')).toEqual(['Rating…']);
    expect(marksOn('4')).toEqual([]);
    expect(rated()).toEqual(['3']);
    // The next card waits for this one's answer, however long it takes.
    await wait(5000);
    expect(rated()).toEqual(['3']);
    await answer(GOOD);
    expect(marksOn('3')).toEqual(['Good 68 · quick']);
    expect(marksOn('4')).toEqual(['Rating…']);
    expect(rated()).toEqual(['3', '4']);
    await answer(GOOD);
    await wait(5000);
    expect(marksOn('4')).toEqual(['Good 68 · quick']);
    expect(rated()).toEqual(['3', '4']);
    expect(looked()).toHaveLength(1);
    expect(most).toBe(1);
  });

  it('cards on screen go first', async () => {
    showList(['1', '2', '3']);
    place('1', -400);
    place('2', 100);
    place('3', 1200);
    start();
    await settle();
    expect(rated()).toEqual(['2']);
    await answer(GOOD);
    // Then the rest, in page order.
    expect(rated()).toEqual(['2', '1']);
    await answer(GOOD);
    expect(rated()).toEqual(['2', '1', '3']);
  });

  it('a hidden tab pauses and carries on when shown', async () => {
    shown = false;
    showList(['1', '2']);
    start();
    await wait(3000);
    expect(rated()).toEqual([]);
    shown = true;
    await wait(1000);
    expect(rated()).toEqual(['1']);
    // Hidden again while card 1 is with the AI: it finishes, and the next waits.
    shown = false;
    await answer(GOOD);
    await wait(3000);
    expect(marksOn('1')).toEqual(['Good 68 · quick']);
    expect(rated()).toEqual(['1']);
    shown = true;
    await wait(1000);
    expect(rated()).toEqual(['1', '2']);
  });

  it('rateLists off: no requests at all', async () => {
    on = false;
    saved = { '1': APPLIED };
    showList(['1', '2']);
    start();
    await wait(5000);
    expect(sent).toEqual([]);
    expect(allMarks()).toBe(0);
  });

  it('no master profile (reason set): no rateCard, no marks', async () => {
    reason = NO_PROFILE;
    saved = { '1': APPLIED };
    showList(['1', '2']);
    start();
    await wait(5000);
    expect(looked()).toEqual([['1', '2']]);
    expect(rated()).toEqual([]);
    expect(allMarks()).toBe(0);
  });

  it('a card rating that comes back with no rating (no master profile) stops the loop and draws nothing', async () => {
    showList(['1', '2']);
    start();
    await settle();
    await answer({ ok: true, data: { rating: null, cached: false, reason: NO_PROFILE } });
    await wait(5000);
    expect(rated()).toEqual(['1']);
    expect(allMarks()).toBe(0);
  });

  it('an offline or error reply stops the loop. Marks already drawn stay. A new list starts it again.', async () => {
    showList(['1', '2', '3']);
    start();
    await settle();
    await answer(GOOD);
    await answer(OFFLINE);
    await wait(5000);
    expect(rated()).toEqual(['1', '2']);
    expect(marksOn('1')).toEqual(['Good 68 · quick']);
    expect(marksOn('2')).toEqual([]);
    // A new search with some of the same jobs.
    href = 'https://www.seek.com.au/developer-jobs?where=Melbourne';
    showList(['3', '1', '2']);
    await wait(1000);
    expect(rated()).toEqual(['1', '2', '3']);
    expect(marksOn('1')).toEqual(['Good 68 · quick']);
    // Any error other than "cancelled" stops it too.
    await answer({ ok: false, error: 'The AI took too long to answer.', offline: false });
    await wait(5000);
    expect(rated()).toEqual(['1', '2', '3']);
    expect(marksOn('3')).toEqual([]);
  });

  it('coming back to the tab starts a stopped loop again', async () => {
    showList(['1', '2']);
    start();
    await settle();
    await answer(OFFLINE);
    await wait(3000);
    expect(rated()).toEqual(['1']);
    shown = false;
    await wait(1000);
    shown = true;
    await wait(1000);
    // Offline isn't the card's fault, so the same card is asked again.
    expect(rated()).toEqual(['1', '1']);
  });

  it('no master profile: coming back to the tab looks the cards up again', async () => {
    reason = NO_PROFILE;
    showList(['1', '2']);
    start();
    await wait(3000);
    expect(looked()).toEqual([['1', '2']]);
    expect(rated()).toEqual([]);
    // You add your master profile in another tab, then come back.
    shown = false;
    await wait(1000);
    reason = null;
    shown = true;
    await wait(1000);
    expect(looked()).toEqual([
      ['1', '2'],
      ['1', '2'],
    ]);
    expect(rated()).toEqual(['1']);
    expect(marksOn('1')).toEqual(['Rating…']);
    // With a profile, coming back to the tab asks nothing more of the app.
    await answer(GOOD);
    await answer(GOOD);
    shown = false;
    await wait(1000);
    shown = true;
    await wait(3000);
    expect(looked()).toHaveLength(2);
    expect(rated()).toEqual(['1', '2']);
  });

  it('stops for good when the extension is reloaded under it (the option check fails)', async () => {
    showList(['1', '2']);
    let checks = 0;
    watcher = watchCards({
      doc,
      location: () => new URL(href),
      extractor: () => site,
      ask: fakeAsk as unknown as typeof ask,
      // Chrome: "Extension context invalidated" after the extension is updated or reloaded.
      enabled: async () => {
        checks++;
        throw new Error('Extension context invalidated.');
      },
      visible: () => shown,
    });
    await settle();
    expect(checks).toBe(1);
    await wait(5000);
    expect(checks).toBe(1);
    expect(sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a card that failed with an error is skipped after that, so it cannot block the list', async () => {
    showList(['1', '2', '3']);
    start();
    await settle();
    expect(rated()).toEqual(['1']);
    await answer({ ok: false, error: "The AI's answer didn't fit. Try again.", offline: false });
    // The error still stops the loop, so a dead AI is asked only once.
    await wait(3000);
    expect(rated()).toEqual(['1']);
    shown = false;
    await wait(1000);
    shown = true;
    await wait(1000);
    // Card 2 goes next, and card 1 is not asked again.
    expect(rated()).toEqual(['1', '2']);
    await answer(GOOD);
    expect(marksOn('2')).toEqual(['Good 68 · quick']);
    expect(rated()).toEqual(['1', '2', '3']);
    await answer(GOOD);
    await wait(3000);
    expect(marksOn('1')).toEqual([]);
    // It stays skipped for this page, even on a new list.
    href = 'https://www.seek.com.au/developer-jobs?where=Melbourne';
    showList(['1', '4']);
    await wait(1000);
    expect(rated()).toEqual(['1', '2', '3', '4']);
  });

  it('a "cancelled" reply does not stop the loop', async () => {
    showList(['1', '2']);
    start();
    await settle();
    await answer({ ok: false, error: 'cancelled', offline: false });
    expect(marksOn('1')).toEqual([]);
    await wait(1000);
    expect(rated()).toEqual(['1', '1']);
    await answer(GOOD);
    expect(rated()).toEqual(['1', '1', '2']);
  });

  it('a lookup the app could not answer stops it too, and is tried again when the loop starts again', async () => {
    showList(['1', '2']);
    const real = fakeAsk;
    let offline = true;
    watcher = watchCards({
      doc,
      location: () => new URL(href),
      extractor: () => site,
      ask: ((req: Request) => (req.type === 'cards' && offline ? (sent.push(req), Promise.resolve(OFFLINE)) : real(req))) as unknown as typeof ask,
      enabled: async () => on,
      visible: () => shown,
    });
    await wait(5000);
    expect(looked()).toEqual([['1', '2']]);
    expect(rated()).toEqual([]);
    offline = false;
    shown = false;
    await wait(1000);
    shown = true;
    await wait(1000);
    expect(looked()).toEqual([
      ['1', '2'],
      ['1', '2'],
    ]);
    expect(rated()).toEqual(['1']);
  });

  it('a new search: the old loop stops, and a late reply is drawn only on a card for the same job', async () => {
    showList(['1', '2', '3']);
    start();
    await settle();
    expect(rated()).toEqual(['1']);
    expect(marksOn('1')).toEqual(['Rating…']);
    // A new search while card 1 is with the AI. The site reuses card 1's
    // element for job 7 (as LinkedIn's list does), and job 1 is further down.
    href = 'https://www.seek.com.au/designer-jobs?where=Sydney';
    const reused = cardEl('1');
    reused.setAttribute('data-id', '7');
    reused.querySelector('h3')!.textContent = 'Job 7';
    cardEl('2').remove();
    cardEl('3').remove();
    addCards(['8', '1']);
    await wait(1000);
    expect(looked()).toEqual([
      ['1', '2', '3'],
      ['7', '8'],
    ]);
    expect(marksOn('7')).toEqual([]);
    expect(marksOn('1')).toEqual(['Rating…']);
    // Never two at once: the new list waits for card 1.
    expect(rated()).toEqual(['1']);
    await answer(GOOD);
    expect(marksOn('1')).toEqual(['Good 68 · quick']);
    expect(marksOn('7')).toEqual(['Rating…']);
    // The new list's first card goes next, not the old list's card 2.
    expect(rated()).toEqual(['1', '7']);
    expect(most).toBe(1);
  });

  it("a late reply for a job that isn't in the new list draws nothing", async () => {
    showList(['1', '2']);
    start();
    await settle();
    href = 'https://www.seek.com.au/designer-jobs?where=Sydney';
    showList(['5', '6']);
    await wait(1000);
    await answer(GOOD);
    expect(marksOn('5')).toEqual(['Rating…']);
    expect(marksOn('6')).toEqual([]);
    expect(rated()).toEqual(['1', '5']);
  });

  it('opening a job from the list is not a new list', async () => {
    showList(['1', '2']);
    start();
    await settle();
    await answer(OFFLINE);
    // Seek's split view puts the open job in ?jobId=, LinkedIn in ?currentJobId=, Indeed in ?vjk=.
    href = 'https://www.seek.com.au/developer-jobs?where=Sydney&jobId=2';
    await wait(3000);
    expect(rated()).toEqual(['1']);
  });

  it("Seek's type parameter on a job you click is not a new list", async () => {
    showList(['1', '2']);
    start();
    await settle();
    await answer(OFFLINE);
    // Seek adds type=standard or type=promoted with the job id when you click a card.
    href = 'https://www.seek.com.au/developer-jobs?where=Sydney&jobId=2&type=standard';
    await wait(3000);
    href = 'https://www.seek.com.au/developer-jobs?where=Sydney&jobId=1&type=promoted';
    await wait(3000);
    expect(rated()).toEqual(['1']);
  });

  it('a redrawn card gets its mark back, once', async () => {
    known = { '1': STRETCH };
    saved = { '2': APPLIED };
    showList(['1', '2']);
    start();
    await settle();
    const before = sent.length;
    // The site redraws card 1 from a copy of itself (with a dead copy of the
    // mark), and card 2 from scratch.
    const one = cardEl('1');
    one.replaceWith(one.cloneNode(true));
    cardEl('2').outerHTML = cardHtml('2');
    expect(marksOn('1')).toEqual(['dead']);
    expect(marksOn('2')).toEqual([]);
    await wait(1000);
    expect(marksOn('1')).toEqual(['Stretch 45 · quick']);
    expect(marksOn('2')).toEqual(['Saved · Applied 12 Oct']);
    await wait(3000);
    expect(marksOn('1')).toEqual(['Stretch 45 · quick']);
    expect(marksOn('2')).toEqual(['Saved · Applied 12 Oct']);
    expect(sent).toHaveLength(before);
  });

  it('cards that load later (scrolling) are looked up in one more cards request', async () => {
    known = { '1': STRETCH, '2': STRETCH, '3': STRETCH, '4': STRETCH };
    showList(['1', '2']);
    start();
    await settle();
    addCards(['3', '4']);
    await wait(1000);
    expect(looked()).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(marksOn('4')).toEqual(['Stretch 45 · quick']);
    await wait(3000);
    expect(looked()).toHaveLength(2);
  });

  it('never asks about more than 100 cards in one request', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => String(i + 1));
    for (const id of ids) known[id] = STRETCH;
    showList(ids);
    start();
    await settle();
    expect(looked().map((cards) => cards.length)).toEqual([100, 50]);
    expect(allMarks()).toBe(150);
  });

  it("showFull turns that card's quick mark into the full one", async () => {
    known = { '1': STRETCH };
    saved = { '2': APPLIED };
    showList(['1', '2', '3']);
    start();
    await settle();
    expect(rated()).toEqual(['3']);
    watcher!.showFull(link('1'), FULL);
    expect(marksOn('1')).toEqual(['Strong 84']);
    expect(tipOn('1')).toBe('You have led a team like this one.');
    // A saved job stays saved, with the full rating in its tooltip.
    watcher!.showFull(link('2'), FULL);
    expect(marksOn('2')).toEqual(['Saved · Applied 12 Oct']);
    // A quick rating that arrives after the full one doesn't replace it.
    watcher!.showFull(link('3'), FULL);
    await answer(GOOD);
    expect(marksOn('3')).toEqual(['Strong 84']);
    await wait(3000);
    expect(marksOn('1')).toEqual(['Strong 84']);
  });

  it('showSaved turns that card into the saved mark at once, keeping its rating', async () => {
    known = { '1': STRETCH };
    showList(['1', '2', '3']);
    start();
    await settle();
    expect(rated()).toEqual(['2']);
    const before = sent.length;
    // You saved job 1 from the panel: its card says so, and the rating moves to the tooltip.
    watcher!.showSaved(link('1'), { ...APPLIED, status: 'saved', dateApplied: null });
    expect(marksOn('1')).toEqual(['Saved']);
    expect(tipOn('1')).toBe('Stretch 45 · quick\nSome of it fits.\nQuick rating from the card. Open the job for a full rating.');
    // Saving the card that's with the AI: it says Saved, and its quick rating is kept when it arrives.
    watcher!.showSaved(link('2'), APPLIED);
    expect(marksOn('2')).toEqual(['Saved · Applied 12 Oct']);
    await answer(GOOD);
    expect(marksOn('2')).toEqual(['Saved · Applied 12 Oct']);
    expect(tipOn('2')).toBe('Good 68 · quick\nYour React work fits.\nQuick rating from the card. Open the job for a full rating.');
    // A saved card is never sent to the AI, and saving asks the app nothing more.
    expect(rated()).toEqual(['2', '3']);
    expect(sent).toHaveLength(before + 1);
    await answer(GOOD);
    await wait(3000);
    expect(marksOn('1')).toEqual(['Saved']);
  });

  it('a save made while the cards are being looked up is not undone by the answer', async () => {
    showList(['1', '2']);
    start();
    // The lookup went out before the save, so its answer says job 1 isn't saved.
    watcher!.showSaved(link('1'), APPLIED);
    await settle();
    expect(marksOn('1')).toEqual(['Saved · Applied 12 Oct']);
    expect(rated()).toEqual(['2']);
  });

  it('showSaved for a job with no card on the page draws nothing', async () => {
    known = { '1': STRETCH };
    showList(['1']);
    start();
    await settle();
    watcher!.showSaved(link('9'), APPLIED);
    expect(allMarks()).toBe(1);
    expect(marksOn('1')).toEqual(['Stretch 45 · quick']);
  });

  it('a page with no cards sends nothing', async () => {
    start();
    await wait(5000);
    expect(sent).toEqual([]);
  });

  it('stop() leaves no timers running and asks nothing more', async () => {
    showList(['1', '2']);
    start();
    await settle();
    watcher!.stop();
    await answer(GOOD);
    expect(vi.getTimerCount()).toBe(0);
    addCards(['3']);
    await wait(5000);
    expect(rated()).toEqual(['1']);
    expect(looked()).toHaveLength(1);
  });
});
