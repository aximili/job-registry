import type { HttpModule } from '../../core/http/module.ts';
import { systemRoutes } from './routes.ts';
import { createSystemService, type SystemOptions, type SystemService } from './service.ts';

export type { SystemService };

export function createSystemModule(opts: SystemOptions & { onShutdown: () => void }): HttpModule<SystemService> {
  const service = createSystemService(opts);
  return { service, routes: systemRoutes(service, opts.onShutdown) };
}
