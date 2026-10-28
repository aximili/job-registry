import type { FastifyPluginAsync } from 'fastify';
import { SearchQuery } from '../../../shared/contracts/index.ts';
import { parseOrThrow } from '../../core/http/validate.ts';
import type { SearchService } from './service.ts';

export function searchRoutes(service: SearchService): FastifyPluginAsync {
  return async (http) => {
    http.get('/search', async (req) => ({ hits: service.query(parseOrThrow(SearchQuery, req.query).q) }));
    http.post('/search/rebuild', async () => service.rebuild());
  };
}
