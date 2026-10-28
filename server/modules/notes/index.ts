import type { Clock } from '../../core/config.ts';
import type { Db } from '../../core/db/db.ts';
import type { EventBus } from '../../core/events.ts';
import type { HttpModule } from '../../core/http/module.ts';
import { createNotesRepo } from './repo.ts';
import { notesRoutes } from './routes.ts';
import { createNotesService, type NotesService } from './service.ts';

export type { NotesService };

export function createNotesModule(opts: { db: Db; bus: EventBus; now: Clock }): HttpModule<NotesService> {
  const service = createNotesService({ repo: createNotesRepo(opts.db), bus: opts.bus, now: opts.now });
  return { service, routes: notesRoutes(service) };
}
