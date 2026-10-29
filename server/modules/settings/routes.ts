import type { FastifyPluginAsync } from 'fastify';
import { UpdateSecretsRequest, UpdateSettingsRequest } from '../../../shared/contracts/index.ts';
import { dashboardOnly } from '../../core/http/security.ts';
import { parseOrThrow } from '../../core/http/validate.ts';
import type { SettingsService } from './service.ts';

export function settingsRoutes(service: SettingsService): FastifyPluginAsync {
  return async (http) => {
    http.get('/settings', async () => service.get());
    http.patch('/settings', { config: dashboardOnly('Only the dashboard can change settings.') }, async (req) =>
      service.update(parseOrThrow(UpdateSettingsRequest, req.body)),
    );
    // Only whether each secret is set; the secret itself never goes to the browser.
    http.get('/settings/secrets', async () => service.secrets());
    http.put('/settings/secrets', { config: dashboardOnly('Only the dashboard can change settings.') }, async (req) =>
      service.updateSecrets(parseOrThrow(UpdateSecretsRequest, req.body)),
    );
  };
}
