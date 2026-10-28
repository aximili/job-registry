import type { FastifyPluginAsync } from 'fastify';
import { IdParams, parseOrThrow } from '../../core/http/validate.ts';
import type { EnrichService } from './service.ts';

// "Parse again" lives here, not in jobs, because jobs never knows about the AI.
export function enrichRoutes(service: EnrichService): FastifyPluginAsync {
  return async (http) => {
    http.post('/jobs/:id/reparse', async (req, reply) => {
      const { id } = parseOrThrow(IdParams, req.params);
      reply.code(202);
      return service.reparse(id);
    });
  };
}
