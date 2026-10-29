import type { FastifyPluginAsync } from 'fastify';
import { ConfirmSuggestionRequest } from '../../../shared/contracts/index.ts';
import { dashboardOnly } from '../../core/http/security.ts';
import { IdParams, parseOrThrow } from '../../core/http/validate.ts';
import type { EmailService } from './service.ts';

// Only the dashboard may act on email, so no installed extension can confirm a suggestion.
const ONLY_DASHBOARD = { config: dashboardOnly('Only the dashboard can handle email.') };

export function emailRoutes(service: EmailService): FastifyPluginAsync {
  return async (http) => {
    http.get('/email/status', async () => service.status());
    http.post('/email/check', ONLY_DASHBOARD, async () => service.checkNow());
    http.post('/email/test', ONLY_DASHBOARD, async () => service.test());
    http.get('/email/suggestions', async () => service.listSuggestions());
    http.post('/email/suggestions/:id/confirm', ONLY_DASHBOARD, async (req) =>
      service.confirm(parseOrThrow(IdParams, req.params).id, parseOrThrow(ConfirmSuggestionRequest, req.body ?? {})),
    );
    http.post('/email/suggestions/:id/dismiss', ONLY_DASHBOARD, async (req) => service.dismiss(parseOrThrow(IdParams, req.params).id));
  };
}
