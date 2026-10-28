import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const NOT_BUILT = "The dashboard isn't built yet. Run setup.bat, or npm run build.";

// Serves the built dashboard. Any page address that isn't a file gets
// index.html, so links like /jobs/42 work after a reload.
export async function serveDashboard(http: FastifyInstance, webDist: string): Promise<void> {
  const built = existsSync(join(webDist, 'index.html'));
  if (built) await http.register(fastifyStatic, { root: webDist });

  http.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? req.url;
    if (path.startsWith('/api/') || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return reply.status(404).send({ error: { code: 'not_found', message: `There's nothing at ${req.method} ${path}.` } });
    }
    if (!built) return reply.status(503).type('text/plain; charset=utf-8').send(NOT_BUILT);
    return reply.sendFile('index.html');
  });
}
