import type { HttpModule } from '../../core/http/module.ts';
import { settingsRoutes } from './routes.ts';
import { createSettingsService, type SettingsOptions, type SettingsService } from './service.ts';

export type { SettingsService };

export function createSettingsModule(opts: SettingsOptions): HttpModule<SettingsService> {
  const service = createSettingsService(opts);
  return { service, routes: settingsRoutes(service) };
}
