// The app only ever runs on this computer, so it refuses anything that
// didn't come from the dashboard or the browser extension. See
// docs/architecture.md §13 (Security).

import type { FastifyInstance } from 'fastify';
import { ForbiddenError } from '../errors.ts';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

// A route with { config: dashboardOnly('…') } refuses writes from browser
// extensions too, with that message. For example, settings choose which
// program the app runs and where your profile and ads are sent, so no
// installed extension may change them.
export const dashboardOnly = (message: string) => ({ dashboardOnly: message });
const EXTENSION_ORIGIN = /^(moz-extension|chrome-extension):\/\//;

export function registerSecurity(http: FastifyInstance, opts: { port: number }): void {
  const hosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  const origins = new Set([`http://127.0.0.1:${opts.port}`, `http://localhost:${opts.port}`]);

  // A plain HTML form on another website can send text/plain without asking
  // the browser first. JSON (and file uploads later) are the only bodies we take.
  http.removeContentTypeParser('text/plain');

  http.addHook('onRequest', async (req, reply) => {
    // Never let a browser guess a reply's type (for example, run text as a script).
    reply.header('x-content-type-options', 'nosniff');

    // Host check: blocks DNS-rebinding tricks from websites.
    const host = (req.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) throw new ForbiddenError('This address is not allowed.');

    // No CORS headers, for anyone. Job Registry's extension has permission to
    // reach this computer, so it doesn't need them; another extension (or a
    // website) without that permission can't read your data.
    const origin = req.headers.origin ?? '';

    // Origin check on writes: blocks other websites from changing your data.
    if (WRITE_METHODS.has(req.method)) {
      if (!origins.has(origin) && !EXTENSION_ORIGIN.test(origin)) {
        throw new ForbiddenError('Changes are only allowed from the dashboard or the browser extension.');
      }
      const only = (req.routeOptions.config as { dashboardOnly?: string } | undefined)?.dashboardOnly;
      if (only && !origins.has(origin)) throw new ForbiddenError(only);
    }
  });
}
