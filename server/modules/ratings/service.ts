// Rates a job ad against your profile, and remembers the answer per ad and per
// version of your profile, so the same ad is never rated twice.

import { createHash } from 'node:crypto';
import type { Rating, RatingsStatus } from '../../../shared/contracts/index.ts';
import type { Clock } from '../../core/config.ts';
import type { AiService, Priority } from '../ai/index.ts';
import type { ProfileService } from '../profile/index.ts';
import type { RatingsRepo } from './repo.ts';

export type RateAd = { canonicalUrl: string | null; jdText: string };
export type RateResult = { rating: Rating | null; cached: boolean; reason: string | null };

export interface RatingsService {
  rate(ad: RateAd, opts?: { signal?: AbortSignal; key?: string; priority?: Priority; force?: boolean }): Promise<RateResult>;
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

    status() {
      return opts.profile.read('master-profile')
        ? { ready: true, detail: 'Ratings use profile/master-profile.md.' }
        : { ready: false, detail: NO_PROFILE };
    },
  };
}
