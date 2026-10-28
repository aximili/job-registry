import type { FastifyPluginAsync } from 'fastify';
import type { SystemService } from './service.ts';

export function systemRoutes(service: SystemService, onShutdown: () => void): FastifyPluginAsync {
  return async (http) => {
    http.get('/health', async () => service.health());
    http.post('/system/backup', async () => ({ file: await service.backupNow() }));
    http.post('/system/shutdown', async (_req, reply) => {
      // Reply first, then stop, so stop.bat sees a clean answer.
      reply.raw.once('finish', () => setImmediate(onShutdown));
      return reply.status(202).send({ ok: true });
    });
  };
}
