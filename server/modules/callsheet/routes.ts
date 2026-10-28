import type { FastifyPluginAsync } from 'fastify';
import { IdParams, parseOrThrow } from '../../core/http/validate.ts';
import type { CallsheetService } from './service.ts';

export function callsheetRoutes(service: CallsheetService): FastifyPluginAsync {
  return async (http) => {
    http.get('/jobs/:id/callsheet', async (req) => service.get(parseOrThrow(IdParams, req.params).id));
  };
}
