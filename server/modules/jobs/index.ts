import type { Status } from '../../../shared/contracts/index.ts';
import type { Clock } from '../../core/config.ts';
import type { Db } from '../../core/db/db.ts';
import type { EventBus } from '../../core/events.ts';
import type { HttpModule } from '../../core/http/module.ts';
import { createJobsRepo } from './repo.ts';
import { jobsRoutes } from './routes.ts';
import { createJobsService, type JobsService } from './service.ts';

export type { JobsService };

export function createJobsModule(opts: {
  db: Db;
  bus: EventBus;
  statuses: () => Status[];
  now: Clock;
}): HttpModule<JobsService> {
  const service = createJobsService({ repo: createJobsRepo(opts.db), bus: opts.bus, statuses: opts.statuses, now: opts.now });
  return { service, routes: jobsRoutes(service) };
}
