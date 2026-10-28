import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';
import { NotFoundError } from '../errors.ts';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp();
});
afterEach(async () => {
  await app.cleanup();
});

describe('HTTP foundation', () => {
  it('GET /api/v1/health returns ok, version and uptime', async () => {
    const res = await app.request('GET', '/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, version: '0.0.0-test' });
    expect(typeof res.body.uptimeSec).toBe('number');
  });

  it('rejects a request whose Host is not 127.0.0.1 or localhost on the port', async () => {
    const res = await app.request('GET', '/api/v1/health', undefined, { host: 'evil.example' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect((await app.request('GET', '/api/v1/health', undefined, { host: 'localhost:4777' })).status).toBe(200);
    expect((await app.request('GET', '/api/v1/health', undefined, { host: '127.0.0.1:9999' })).status).toBe(403);
  });

  it('rejects a write without an Origin, or from another website', async () => {
    const none = await app.request('POST', '/api/v1/system/backup', undefined, { origin: '' });
    expect(none.status).toBe(403);
    const evil = await app.request('POST', '/api/v1/system/backup', undefined, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe('forbidden');
  });

  it('allows writes from the dashboard and from extension origins', async () => {
    for (const origin of ['http://127.0.0.1:4777', 'http://localhost:4777', 'moz-extension://abc', 'chrome-extension://xyz']) {
      const res = await app.request('POST', '/api/v1/system/backup', undefined, { origin });
      expect(res.status, origin).toBe(200);
    }
  });

  it('rejects text/plain bodies', async () => {
    const res = await app.request('PATCH', '/api/v1/settings', 'hello', { 'content-type': 'text/plain' });
    expect(res.status).toBe(415);
    expect(res.body.error).toBeDefined();
  });

  it('returns not_found JSON for unknown API routes', async () => {
    const res = await app.request('GET', '/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('maps AppError subclasses and hides unknown errors', async () => {
    app.http.get('/api/v1/__missing', async () => {
      throw new NotFoundError('Job 9 not found');
    });
    app.http.get('/api/v1/__boom', async () => {
      throw new Error('boom');
    });
    const missing = await app.request('GET', '/api/v1/__missing');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: { code: 'not_found', message: 'Job 9 not found' } });
    const boom = await app.request('GET', '/api/v1/__boom');
    expect(boom.status).toBe(500);
    expect(boom.body).toEqual({
      error: { code: 'internal', message: 'Something went wrong. See the log for details.' },
    });
  });

  it('serves a plain message when the dashboard is not built', async () => {
    const res = await app.request('GET', '/');
    expect(res.status).toBe(503);
    expect(res.body).toBe("The dashboard isn't built yet. Run setup.bat, or npm run build.");
  });

  it('every response says not to guess its content type (nosniff)', async () => {
    const res = await app.request('GET', '/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it("sends no CORS headers, so an extension without permission to reach this computer can't read your data", async () => {
    // Job Registry's own extension has that permission, and needs no CORS.
    const other = 'chrome-extension://someotherextension';
    const get = await app.request('GET', '/api/v1/jobs', undefined, { origin: other });
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await app.request('OPTIONS', '/api/v1/jobs', undefined, { origin: other, 'access-control-request-method': 'POST' });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.status).not.toBe(204);
  });

  it('a refused address still says not to guess the reply type', async () => {
    const res = await app.request('GET', '/api/v1/health', undefined, { host: 'evil.example' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

