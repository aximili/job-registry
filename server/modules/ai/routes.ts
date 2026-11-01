import type { FastifyPluginAsync } from 'fastify';
import type { z } from 'zod';
import { AiCheckRequest } from '../../../shared/contracts/index.ts';
import { dashboardOnly } from '../../core/http/security.ts';
import { parseOrThrow } from '../../core/http/validate.ts';
import type { AiService } from './service.ts';

// Why a request to test an AI was refused. zod quotes a name it didn't
// expect, and this request can hold an API key, so this never repeats one.
function checkRequestProblem(error: z.core.$ZodError): string {
  return error.issues
    .map((issue) => {
      const at = issue.path.length > 0 ? ` (at ${issue.path.join('.')})` : '';
      return issue.code === 'unrecognized_keys' ? `There's a name the AI settings don't have${at}.` : `${issue.message}${at}`;
    })
    .join(' ');
}

export function aiRoutes(service: AiService): FastifyPluginAsync {
  return async (http) => {
    http.get('/ai/status', async () => service.status());
    // The AI in use, as saved.
    http.post('/ai/test', async () => service.test());
    // Any AI in Settings → AI, saved or not, with the key you typed. Only
    // the dashboard: a key goes in, and the AI's address comes from the request.
    const onlyDashboard = { config: dashboardOnly('Only the dashboard can test an AI.') };
    http.post('/ai/check', onlyDashboard, async (req) => service.check(parseOrThrow(AiCheckRequest, req.body, checkRequestProblem)));
    http.post('/ai/models', onlyDashboard, async (req) => service.models(parseOrThrow(AiCheckRequest, req.body, checkRequestProblem)));
  };
}
