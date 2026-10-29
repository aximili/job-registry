import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { CardsLookupRequest, RateCardRequest, RateRequest } from '../../../shared/contracts/index.ts';
import { parseOrThrow } from '../../core/http/validate.ts';
import type { RatingsService } from './service.ts';

// When the browser gives up on a request (you moved to the next job, or to
// another search), its rating is cancelled, so the GPU moves on too.
function cancelOnClose(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller.signal;
}

export function ratingsRoutes(service: RatingsService): FastifyPluginAsync {
  return async (http) => {
    http.post('/ratings', async (req, reply) => {
      const body = parseOrThrow(RateRequest, req.body);
      return service.rate(body.capture, { signal: cancelOnClose(reply), key: body.key, priority: 'interactive' });
    });
    http.post('/ratings/card', async (req, reply) => {
      const body = parseOrThrow(RateCardRequest, req.body);
      return service.rateCard(body.card, { signal: cancelOnClose(reply), key: body.key });
    });
    http.post('/ratings/cards/lookup', async (req) => service.lookupCards(parseOrThrow(CardsLookupRequest, req.body).cards));
    http.get('/ratings/status', async () => service.status());
  };
}
