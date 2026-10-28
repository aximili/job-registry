import type { EventBus } from '../../core/events.ts';
import type { HttpModule } from '../../core/http/module.ts';
import { settingsRoutes } from './routes.ts';
import { createSettingsService, type SettingsService } from './service.ts';

export type { SettingsService };

export function createSettingsModule(opts: { file: string; bus: EventBus }): HttpModule<SettingsService> {
  const service = createSettingsService(opts);
  return { service, routes: settingsRoutes(service) };
}
