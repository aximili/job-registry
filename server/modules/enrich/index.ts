import type { EventBus } from '../../core/events.ts';
import type { HttpModule } from '../../core/http/module.ts';
import type { Logger } from '../../core/logger.ts';
import type { AiService } from '../ai/index.ts';
import type { JobsService } from '../jobs/index.ts';
import type { RatingsService } from '../ratings/index.ts';
import { enrichRoutes } from './routes.ts';
import { createEnrichService, type EnrichService } from './service.ts';

export type { EnrichService };

export function createEnrichModule(opts: {
  bus: EventBus;
  jobs: JobsService;
  ai: AiService;
  ratings: RatingsService;
  logger: Logger;
}): HttpModule<EnrichService> {
  const service = createEnrichService(opts);
  return { service, routes: enrichRoutes(service) };
}
