import type { FastifyPluginAsync } from 'fastify';
import { UpdateSecretsRequest, UpdateSettingsRequest, UseAiRequest, UseWriterRequest } from '../../../shared/contracts/index.ts';
import { dashboardOnly } from '../../core/http/security.ts';
import { parseOrThrow } from '../../core/http/validate.ts';
import { secretsRequestProblem, type SettingsService } from './service.ts';

export function settingsRoutes(service: SettingsService): FastifyPluginAsync {
  return async (http) => {
    http.get('/settings', async () => service.get());
    http.patch('/settings', { config: dashboardOnly('Only the dashboard can change settings.') }, async (req) =>
      service.update(parseOrThrow(UpdateSettingsRequest, req.body)),
    );
    // Switch the AI the whole app uses.
    http.put('/settings/ai/active', { config: dashboardOnly('Only the dashboard can change settings.') }, async (req) =>
      service.useAi(parseOrThrow(UseAiRequest, req.body).id),
    );
    // Pick the AI that writes your documents, or null for the AI in use.
    http.put('/settings/ai/writer', { config: dashboardOnly('Only the dashboard can change settings.') }, async (req) =>
      service.useWriter(parseOrThrow(UseWriterRequest, req.body).id),
    );
    // Only whether each secret is set; the secret itself never goes to the browser.
    http.get('/settings/secrets', async () => service.secrets());
    http.put('/settings/secrets', { config: dashboardOnly('Only the dashboard can change settings.') }, async (req) =>
      service.updateSecrets(parseOrThrow(UpdateSecretsRequest, req.body, secretsRequestProblem)),
    );
  };
}
