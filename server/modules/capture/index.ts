import type { Clock } from '../../core/config.ts';
import type { HttpModule } from '../../core/http/module.ts';
import { captureRoutes } from './routes.ts';
import { createCaptureService, type CaptureService } from './service.ts';

export type { CaptureService };

export function createCaptureModule(opts: { fetch?: typeof fetch; now: Clock }): HttpModule<CaptureService> {
  const service = createCaptureService(opts);
  return { service, routes: captureRoutes(service) };
}
