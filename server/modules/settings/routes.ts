import type { FastifyPluginAsync } from 'fastify';
import { UpdateSettingsRequest } from '../../../shared/contracts/index.ts';
import { dashboardOnly } from '../../core/http/security.ts';
import { parseOrThrow } from '../../core/http/validate.ts';
import type { SettingsService } from './service.ts';

export function settingsRoutes(service: SettingsService): FastifyPluginAsync {
  return async (http) => {
    http.get('/settings', async () => service.get());
    http.patch('/settings', { config: dashboardOnly('Only the dashboard can change settings.') }, async (req) =>
      service.update(parseOrThrow(UpdateSettingsRequest, req.body)),
    );
  };
}
