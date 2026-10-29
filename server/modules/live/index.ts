// Pushes changes to open dashboard tabs as server-sent events, so a page
// refreshes itself when something it shows changes.

import type { ServerResponse } from 'node:http';
import type { FastifyPluginAsync } from 'fastify';
import type { EventBus } from '../../core/events.ts';
import type { HttpModule } from '../../core/http/module.ts';

export interface LiveService {
  clientCount(): number;
}

const FORWARDED = /^(job\.|note\.|contact\.|profile\.|document\.|attachment\.|posting\.added$|interaction\.logged$|settings\.changed$|ai\.|enrich\.|email\.)/;
const HEARTBEAT_MS = 25_000;

export function createLiveModule(opts: { bus: EventBus; heartbeatMs?: number }): HttpModule<LiveService> {
  const clients = new Set<ServerResponse>();

  opts.bus.onAny((name, payload) => {
    if (!FORWARDED.test(name)) return;
    const chunk = `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) client.write(chunk);
  });

  const routes: FastifyPluginAsync = async (http) => {
    http.get('/events', (req, reply) => {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      // A comment line now and then keeps the connection from timing out.
      const heartbeat = setInterval(() => res.write(': ping\n\n'), opts.heartbeatMs ?? HEARTBEAT_MS);
      req.raw.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });
    });

    http.addHook('onClose', async () => {
      for (const client of clients) client.end();
      clients.clear();
    });
  };

  return { service: { clientCount: () => clients.size }, routes };
}
