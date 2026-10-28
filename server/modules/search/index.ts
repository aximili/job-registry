import type { Status } from '../../../shared/contracts/index.ts';
import type { Db } from '../../core/db/db.ts';
import type { EventBus } from '../../core/events.ts';
import type { HttpModule } from '../../core/http/module.ts';
import type { ContactsService } from '../contacts/index.ts';
import type { JobsService } from '../jobs/index.ts';
import type { NotesService } from '../notes/index.ts';
import { createSearchRepo } from './repo.ts';
import { searchRoutes } from './routes.ts';
import { createSearchService, type SearchService } from './service.ts';

export type { SearchService };

export function createSearchModule(opts: {
  db: Db;
  bus: EventBus;
  jobs: JobsService;
  contacts: ContactsService;
  notes: NotesService;
  statuses: () => Status[];
}): HttpModule<SearchService> {
  const service = createSearchService({ ...opts, repo: createSearchRepo(opts.db) });
  return { service, routes: searchRoutes(service) };
}
