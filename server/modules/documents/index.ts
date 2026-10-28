import type { Clock } from '../../core/config.ts';
import type { Db } from '../../core/db/db.ts';
import type { EventBus } from '../../core/events.ts';
import type { HttpModule } from '../../core/http/module.ts';
import type { AiService } from '../ai/index.ts';
import type { JobsService } from '../jobs/index.ts';
import type { ProfileService } from '../profile/index.ts';
import type { DocumentExporter } from './exporter.ts';
import { createDocumentsRepo } from './repo.ts';
import { documentsRoutes } from './routes.ts';
import { createDocumentsService, type DocumentsService } from './service.ts';

export type { DocumentExporter, DocumentsService };
// The exporters, for app.ts to wire. Nothing else imports these.
export { createDocxExporter } from './exporters/docx.ts';
export { createPrintHtmlExporter } from './exporters/print-html.ts';

export function createDocumentsModule(opts: {
  db: Db;
  bus: EventBus;
  now: Clock;
  ai: AiService;
  profile: ProfileService;
  jobs: JobsService;
  exporters: DocumentExporter[];
  filesDir: string;
}): HttpModule<DocumentsService> {
  const service = createDocumentsService({ repo: createDocumentsRepo(opts.db), ...opts });
  return { service, routes: documentsRoutes(service) };
}
