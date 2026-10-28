import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ now: () => new Date('2026-10-28T03:15:00.000Z') });
});
afterEach(async () => {
  await app.cleanup();
});

it('POST /captures/preview turns pasted text into a capture', async () => {
  const res = await app.request('POST', '/api/v1/captures/preview', { text: 'Senior Engineer\r\nAtlassian' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    capture: {
      sourceUrl: null,
      canonicalUrl: null,
      sourceSite: 'pasted',
      externalId: null,
      jdText: 'Senior Engineer\nAtlassian',
      capturedAt: '2026-10-28T03:15:00.000Z',
    },
    warning: null,
  });
});

it('POST /captures/preview validates the body', async () => {
  const res = await app.request('POST', '/api/v1/captures/preview', { url: 'not a url' });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('validation');
});
