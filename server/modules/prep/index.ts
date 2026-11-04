import type { Clock } from '../../core/config.ts';
import type { Db } from '../../core/db/db.ts';
import type { EventBus } from '../../core/events.ts';
import type { HttpModule } from '../../core/http/module.ts';
import type { Logger } from '../../core/logger.ts';
import type { AiService } from '../ai/index.ts';
import type { JobsService } from '../jobs/index.ts';
import type { NotesService } from '../notes/index.ts';
import type { ProfileService } from '../profile/index.ts';
import { createPrepRepo } from './repo.ts';
import { prepRoutes } from './routes.ts';
import { createPrepService, type PrepService } from './service.ts';

export type { PrepService };

export function createPrepModule(opts: {
  db: Db;
  bus: EventBus;
  now: Clock;
  logger: Logger;
  ai: AiService;
  profile: ProfileService;
  jobs: JobsService;
  notes: NotesService;
  // How often a quiet reply says it's still there (tests make it short).
  heartbeatMs?: number;
}): HttpModule<PrepService> {
  const service = createPrepService({ repo: createPrepRepo(opts.db), ...opts });
  return { service, routes: prepRoutes(service, { heartbeatMs: opts.heartbeatMs }) };
}
