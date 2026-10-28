import type { HttpModule } from '../../core/http/module.ts';
import { callsheetRoutes } from './routes.ts';
import { createCallsheetService, type CallsheetOptions, type CallsheetService } from './service.ts';

export type { CallsheetService };

export function createCallsheetModule(opts: CallsheetOptions): HttpModule<CallsheetService> {
  const service = createCallsheetService(opts);
  return { service, routes: callsheetRoutes(service) };
}
