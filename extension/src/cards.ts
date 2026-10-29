// Quick marks on a search list (architecture §7.7). Every second, this reads
// the job cards on the page. New cards are looked up in one `cards` request:
// the jobs you saved, and the marks they already have. Then each card with
// nothing yet goes to the AI for a quick rating, one at a time, the cards on
// screen first, and only while this tab is in front.
//
// What's known is kept by the job's link, not by the card on the page. A
// site that redraws a card, or reuses it for another job, gets the right
// mark back on the next read.

import type { CardMark, ExactMatch, JobCard, Rating } from '../../shared/contracts/index.ts';
import { drawMark, removeMark, type MarkState } from './marks.ts';
import type { ask } from './messages.ts';
import type { FoundCard, SiteExtractor } from './sites/index.ts';

export type CardWatchOptions = {
  doc: Document;
  location: () => URL;
  extractor: () => SiteExtractor;
  ask: typeof ask;
  // The extension's option "Rate the jobs in search results".
  enabled: () => Promise<boolean>;
  // Whether this tab is the one in front.
  visible: () => boolean;
  intervalMs?: number;
};

// The background takes at most this many cards in one request.
const MAX_CARDS = 100;

// The job open in a split view isn't part of the search, so opening one
// isn't a new list (Seek, LinkedIn and Indeed, in that order). Seek also
// adds `type` (standard or promoted) when you click a card.
const OPEN_JOB_PARAMS = ['jobId', 'type', 'currentJobId', 'vjk'];

function listOf(url: URL): string {
  const params = new URLSearchParams(url.search);
  for (const name of OPEN_JOB_PARAMS) params.delete(name);
  return `${url.pathname}?${params}`;
}

export type CardWatcher = {
  stop(): void;
  showFull(canonicalUrl: string, rating: Rating): void;
  showSaved(canonicalUrl: string, saved: ExactMatch): void;
};

export function watchCards(opts: CardWatchOptions): CardWatcher {
  const intervalMs = opts.intervalMs ?? 1000;
  // By job link: whether you saved it, and its mark. A link is here once
  // its lookup has come back (or a full rating arrived for it).
  const known = new Map<string, { saved: ExactMatch | null; mark: CardMark | null }>();
  // Links sent in a `cards` request, answered or not, so each goes once.
  const asked = new Set<string>();
  // Links whose quick rating failed with an error (not offline, not
  // "cancelled"). They aren't asked again on this page, so one card the AI
  // can't rate never blocks the rest of the list. Reloading the page clears it.
  const failed = new Set<string>();
  // Why no card can get a mark (no master profile yet), from the last lookup.
  let reason: string | null = null;
  let list: string | null = null;
  // Bumped on each new list, so an old list's failure can't stop the new one.
  let round = 0;
  // The app or the AI stopped answering. Nothing more is asked until you
  // come back to this tab or start a new list.
  let halted = false;
  // The link of the card that's with the AI. Only ever one.
  let rating: string | null = null;
  let on = false;
  let wasVisible = opts.visible();
  let busy = false;
  let stopped = false;

  function read(): FoundCard[] {
    try {
      return opts.extractor().readCards(opts.doc, opts.location());
    } catch {
      // A reader that trips over an odd page has simply found no cards yet.
      return [];
    }
  }

  function stateOf(link: string): MarkState | null {
    if (reason !== null) return null;
    const k = known.get(link);
    if (k?.saved) return { kind: 'saved', saved: k.saved, mark: k.mark };
    if (k?.mark) return { kind: 'mark', mark: k.mark };
    if (rating === link) return { kind: 'rating' };
    return null;
  }

  // Each card gets the mark for its own job, and a card with nothing known
  // loses any mark it has (the site may have reused it for another job).
  function paint(cards: FoundCard[] = read()): void {
    for (const found of cards) {
      const state = stateOf(found.card.canonicalUrl);
      if (state) drawMark(found, state);
      else removeMark(found);
    }
  }

  function lookUp(cards: FoundCard[]): void {
    if (halted) return;
    const fresh = cards.map((f) => f.card).filter((c) => !asked.has(c.canonicalUrl));
    for (let i = 0; i < fresh.length; i += MAX_CARDS) void lookUpSome(fresh.slice(i, i + MAX_CARDS));
  }

  async function lookUpSome(cards: JobCard[]): Promise<void> {
    const mine = round;
    for (const c of cards) asked.add(c.canonicalUrl);
    const res = await opts.ask({ type: 'cards', cards });
    if (stopped) return;
    if (!res.ok) {
      // Ask about these again when the loop starts again.
      for (const c of cards) asked.delete(c.canonicalUrl);
      if (mine === round && res.error !== 'cancelled') halted = true;
      return;
    }
    reason = res.data.reason;
    cards.forEach((c, i) => {
      const before = known.get(c.canonicalUrl);
      // A full rating, or a save, that arrived meanwhile stays.
      known.set(c.canonicalUrl, {
        saved: res.data.saved[i] ?? before?.saved ?? null,
        mark: before?.mark ?? res.data.marks[i] ?? null,
      });
    });
    paint();
    void next();
  }

  // The card to rate next: the first with nothing known that's on screen,
  // else the first in page order. A card that failed before is skipped.
  function pick(cards: FoundCard[]): FoundCard | null {
    const left = cards.filter((f) => {
      const k = known.get(f.card.canonicalUrl);
      return k !== undefined && !k.saved && !k.mark && !failed.has(f.card.canonicalUrl);
    });
    return left.find((f) => onScreen(f.element)) ?? left[0] ?? null;
  }

  function onScreen(el: Element): boolean {
    const box = el.getBoundingClientRect();
    const height = opts.doc.defaultView?.innerHeight ?? 0;
    return box.height > 0 && box.bottom > 0 && box.top < height;
  }

  // Rates one card, then the next. Never more than one at a time.
  async function next(): Promise<void> {
    if (stopped || !on || halted || reason !== null || rating !== null || !opts.visible()) return;
    const cards = read();
    const found = pick(cards);
    if (!found) return;
    const mine = round;
    const link = found.card.canonicalUrl;
    rating = link;
    paint(cards);
    const res = await opts.ask({ type: 'rateCard', card: found.card });
    rating = null;
    if (stopped) return;
    const rated = res.ok ? res.data.rating : null;
    if (rated) {
      // A card already with the AI finishes and is kept, even after a new
      // search. Its mark goes only on a card for the same job.
      const before = known.get(link);
      if (before?.mark?.kind !== 'full') {
        known.set(link, { saved: before?.saved ?? null, mark: { kind: 'quick', verdict: rated.verdict, score: rated.score, reason: rated.reason } });
      }
    } else {
      // An error about this card: skip it from now on. Offline is the app,
      // not the card, so that card is asked again later.
      if (!res.ok && !res.offline && res.error !== 'cancelled') failed.add(link);
      // Offline, an error, or no master profile: stop, rather than ask again
      // and again. A newer request that replaced this one ("cancelled") isn't
      // a stop.
      if (mine === round && (res.ok || res.error !== 'cancelled')) halted = true;
    }
    paint();
    // After "cancelled", carry on at the next read rather than at once.
    if (res.ok) void next();
  }

  async function tick(): Promise<void> {
    if (stopped || busy) return;
    busy = true;
    try {
      const where = listOf(opts.location());
      if (where !== list) {
        // A new search: start again, but keep what's known about each job.
        list = where;
        round++;
        halted = false;
      }
      const visible = opts.visible();
      if (visible && !wasVisible) {
        // Coming back to the tab tries again after a stop.
        halted = false;
        // There was no master profile. You may have added one meanwhile, so
        // look the cards up again.
        if (reason !== null) asked.clear();
      }
      wasVisible = visible;
      const cards = read();
      if (cards.length === 0) return;
      try {
        on = await opts.enabled();
      } catch {
        // The extension was updated or reloaded, so this copy can't reach
        // the browser any more ("Extension context invalidated"). Stop for
        // good: reloading the page starts the new copy.
        stop();
        return;
      }
      if (!on || stopped) return;
      paint(cards);
      lookUp(cards);
      void next();
    } finally {
      busy = false;
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  function stop(): void {
    stopped = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  void tick();
  if (!stopped) timer = setInterval(() => void tick(), intervalMs);

  return {
    stop,
    // The job you opened got its full rating: its card shows that instead.
    showFull(canonicalUrl, r) {
      const before = known.get(canonicalUrl);
      known.set(canonicalUrl, { saved: before?.saved ?? null, mark: { kind: 'full', verdict: r.verdict, score: r.score, reason: r.why[0] ?? null } });
      if (on && !stopped) paint();
    },
    // You saved the job from the panel: its card says so at once, and keeps
    // any rating it has (in the tooltip).
    showSaved(canonicalUrl, saved) {
      const before = known.get(canonicalUrl);
      known.set(canonicalUrl, { saved, mark: before?.mark ?? null });
      if (on && !stopped) paint();
    },
  };
}
