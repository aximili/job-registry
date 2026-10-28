import type { FastifyError, FastifyInstance } from 'fastify';
import type { ErrorCode } from '../../../shared/contracts/index.ts';
import { AppError } from '../errors.ts';
import type { Logger } from '../logger.ts';

// Turns every error into { error: { code, message } }. Unknown errors are
// logged in full but shown to the user only as a plain sentence.
export function registerErrorHandler(http: FastifyInstance, logger: Logger): void {
  http.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    const status = err.statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: codeFor(status), message: err.message } });
    }
    logger.error({ err, method: req.method, url: req.url }, 'Request failed');
    return reply.status(500).send({
      error: { code: 'internal', message: 'Something went wrong. See the log for details.' },
    });
  });
}

function codeFor(status: number): ErrorCode {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  return 'validation';
}
