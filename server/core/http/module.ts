import type { FastifyPluginAsync } from 'fastify';

// What every feature module hands to app.ts: its service, plus its HTTP routes.
export type HttpModule<S> = {
  service: S;
  routes: FastifyPluginAsync;
};
