import type { FastifyPluginAsync } from 'fastify';
import type { AiService } from './service.ts';

export function aiRoutes(service: AiService): FastifyPluginAsync {
  return async (http) => {
    http.get('/ai/status', async () => service.status());
    http.post('/ai/test', async () => service.test());
  };
}
