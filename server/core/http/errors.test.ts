import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logger.ts';
import { registerErrorHandler } from './errors.ts';

describe('error handler', () => {
  it("a request whose work was cancelled is quiet: no error in the log, and a plain reply", async () => {
    const logger = { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as Logger & { error: ReturnType<typeof vi.fn> };
    const http = Fastify();
    registerErrorHandler(http, logger);
    http.get('/x', async () => {
      throw new DOMException('The AI task was cancelled.', 'AbortError');
    });
    const res = await http.inject({ method: 'GET', url: '/x' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: { code: 'ai_unavailable', message: 'The AI task was cancelled.' } });
    expect(logger.error).not.toHaveBeenCalled();
    await http.close();
  });
});
