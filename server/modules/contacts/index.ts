import type { Clock } from '../../core/config.ts';
import type { Db } from '../../core/db/db.ts';
import type { EventBus } from '../../core/events.ts';
import type { HttpModule } from '../../core/http/module.ts';
import { createContactsRepo } from './repo.ts';
import { contactsRoutes } from './routes.ts';
import { createContactsService, type ContactsService } from './service.ts';

export type { ContactsService };

export function createContactsModule(opts: { db: Db; bus: EventBus; now: Clock }): HttpModule<ContactsService> {
  const service = createContactsService({ repo: createContactsRepo(opts.db), bus: opts.bus, now: opts.now });
  return { service, routes: contactsRoutes(service) };
}
