import type { FastifyPluginAsync } from 'fastify';
import { RateRequest } from '../../../shared/contracts/index.ts';
import { parseOrThrow } from '../../core/http/validate.ts';
import type { RatingsService } from './service.ts';

export function ratingsRoutes(service: RatingsService): FastifyPluginAsync {
  return async (http) => {
    http.post('/ratings', async (req, reply) => {
      const body = parseOrThrow(RateRequest, req.body);
      // When the browser gives up on this request (you moved to the next job),
      // the rating is cancelled, so the GPU moves on too.
      const controller = new AbortController();
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) controller.abort();
      });
      return service.rate(body.capture, { signal: controller.signal, key: body.key, priority: 'interactive' });
    });
    http.get('/ratings/status', async () => service.status());
  };
}
