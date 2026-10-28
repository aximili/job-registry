import type { Clock } from '../../core/config.ts';
import type { Db } from '../../core/db/db.ts';
import type { HttpModule } from '../../core/http/module.ts';
import type { AiService } from '../ai/index.ts';
import type { ProfileService } from '../profile/index.ts';
import { createRatingsRepo } from './repo.ts';
import { ratingsRoutes } from './routes.ts';
import { adKey, createRatingsService, type RateAd, type RateResult, type RatingsService } from './service.ts';

export { adKey };
export type { RateAd, RateResult, RatingsService };

export function createRatingsModule(opts: { db: Db; ai: AiService; profile: ProfileService; now: Clock }): HttpModule<RatingsService> {
  const service = createRatingsService({ repo: createRatingsRepo(opts.db), ai: opts.ai, profile: opts.profile, now: opts.now });
  return { service, routes: ratingsRoutes(service) };
}
