// Rates a job ad against your profile, and remembers the answer per ad and per
// version of your profile, so the same ad is never rated twice. It does the
// same for a quick rating of a job card in a search list.

import { createHash } from 'node:crypto';
import type {
  CardMark,
  CardsLookupResponse,
  JobCard,
  RateCardResponse,
  Rating,
  RatingsStatus,
} from '../../../shared/contracts/index.ts';
import type { Clock } from '../../core/config.ts';
import type { AiService, Priority } from '../ai/index.ts';
import type { ProfileService } from '../profile/index.ts';
import type { RatingsRepo } from './repo.ts';

export type RateAd = { canonicalUrl: string | null; jdText: string };
export type RateResult = { rating: Rating | null; cached: boolean; reason: string | null };

export interface RatingsService {
  rate(ad: RateAd, opts?: { signal?: AbortSignal; key?: string; priority?: Priority; force?: boolean }): Promise<RateResult>;
  rateCard(card: JobCard, opts?: { signal?: AbortSignal; key?: string }): Promise<RateCardResponse>;
  lookupCards(cards: JobCard[]): CardsLookupResponse;
  status(): RatingsStatus;
}

export const NO_PROFILE = 'Add your master profile in Settings → Profile to get match ratings.';

// The ad's link and a short hash of its text: the same ad read again gets
// the cached rating, but a fuller or changed read of it is rated afresh. A
// pasted ad has no link, so its text alone stands in.
export function adKey(ad: RateAd): string {
  const text = createHash('sha256').update(ad.jdText.trim()).digest('hex');
  return ad.canonicalUrl ? `${ad.canonicalUrl}#${text.slice(0, 16)}` : `text:${text}`;
}

// What the AI reads from a card: its title, company, location and text, one
// per line, leaving out the empty ones.
export function cardText(card: JobCard): string {
  return [card.title, card.company, card.location, card.text]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join('\n');
}

// Like adKey: a card that shows something new is rated afresh.
export function cardKey(card: JobCard): string {
  const text = createHash('sha256').update(cardText(card)).digest('hex');
  return `${card.canonicalUrl}#${text.slice(0, 16)}`;
}

export function createRatingsService(opts: { repo: RatingsRepo; ai: AiService; profile: ProfileService; now: Clock }): RatingsService {
  return {
    async rate(ad, o = {}) {
      const profile = opts.profile.read('master-profile');
      if (!profile) return { rating: null, cached: false, reason: NO_PROFILE };
      const hash = opts.profile.hash();
      const key = adKey(ad);
      if (!o.force) {
        const cached = opts.repo.get(key, hash);
        if (cached) return { rating: cached, cached: true, reason: null };
      }
      const rating = await opts.ai.rateJob(
        { profile, preferences: opts.profile.read('preferences'), ad: ad.jdText },
        { signal: o.signal, key: o.key, priority: o.priority },
      );
      opts.repo.put(key, hash, rating, opts.now().toISOString());
      return { rating, cached: false, reason: null };
    },

    // The AI's queue runs it at its default "list" priority, after a job you opened.
    async rateCard(card, o = {}) {
      const profile = opts.profile.read('master-profile');
      if (!profile) return { rating: null, cached: false, reason: NO_PROFILE };
      const hash = opts.profile.hash();
      const key = cardKey(card);
      const cached = opts.repo.getCard(key, hash);
      if (cached) return { rating: cached, cached: true, reason: null };
      const rating = await opts.ai.rateCard(
        { profile, preferences: opts.profile.read('preferences'), card: cardText(card) },
        { signal: o.signal, key: o.key },
      );
      opts.repo.putCard(key, hash, rating, opts.now().toISOString());
      return { rating, cached: false, reason: null };
    },

    // What's known about each card without the AI: the full rating of a job
    // you opened comes first, then a quick rating of this card.
    lookupCards(cards) {
      if (!opts.profile.read('master-profile')) return { results: cards.map(() => null), reason: NO_PROFILE };
      const hash = opts.profile.hash();
      const results = cards.map((card): CardMark | null => {
        const full = opts.repo.latestFull(card.canonicalUrl, hash);
        if (full) return { kind: 'full', verdict: full.verdict, score: full.score, reason: full.why[0] ?? null };
        const quick = opts.repo.getCard(cardKey(card), hash);
        if (quick) return { kind: 'quick', verdict: quick.verdict, score: quick.score, reason: quick.reason };
        return null;
      });
      return { results, reason: null };
    },

    status() {
      return opts.profile.read('master-profile')
        ? { ready: true, detail: 'Ratings use profile/master-profile.md.' }
        : { ready: false, detail: NO_PROFILE };
    },
  };
}
