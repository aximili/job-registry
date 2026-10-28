// The app only ever runs on this computer, so it refuses anything that
// didn't come from the dashboard or the browser extension. See
// docs/architecture.md §13 (Security).

import type { FastifyInstance } from 'fastify';
import { ForbiddenError } from '../errors.ts';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const EXTENSION_ORIGIN = /^(moz-extension|chrome-extension):\/\//;

export function registerSecurity(http: FastifyInstance, opts: { port: number }): void {
  const hosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  const origins = new Set([`http://127.0.0.1:${opts.port}`, `http://localhost:${opts.port}`]);

  // A plain HTML form on another website can send text/plain without asking
  // the browser first. JSON (and file uploads later) are the only bodies we take.
  http.removeContentTypeParser('text/plain');

  http.addHook('onRequest', async (req) => {
    // Host check: blocks DNS-rebinding tricks from websites.
    const host = (req.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) throw new ForbiddenError('This address is not allowed.');

    // Origin check on writes: blocks other websites from changing your data.
    if (WRITE_METHODS.has(req.method)) {
      const origin = req.headers.origin ?? '';
      if (!origins.has(origin) && !EXTENSION_ORIGIN.test(origin)) {
        throw new ForbiddenError('Changes are only allowed from the dashboard or the browser extension.');
      }
    }
  });
}
