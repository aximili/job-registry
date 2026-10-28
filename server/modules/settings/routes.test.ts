import { afterEach, beforeEach, expect, it } from 'vitest';
import { DEFAULT_STATUSES } from '../../../shared/contracts/index.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp();
});
afterEach(async () => {
  await app.cleanup();
});

it('GET and PATCH /settings round-trip and validate', async () => {
  const before = await app.request('GET', '/api/v1/settings');
  expect(before.status).toBe(200);
  expect(before.body.statuses).toHaveLength(11);

  const renamed = DEFAULT_STATUSES.map((s) => (s.id === 'interview_1' ? { ...s, label: 'First interview' } : s));
  const patched = await app.request('PATCH', '/api/v1/settings', { statuses: renamed });
  expect(patched.status).toBe(200);
  expect(patched.body.statuses.find((s: { id: string }) => s.id === 'interview_1').label).toBe('First interview');

  const dupes = await app.request('PATCH', '/api/v1/settings', { statuses: [DEFAULT_STATUSES[0], DEFAULT_STATUSES[0]] });
  expect(dupes.status).toBe(400);
  expect(dupes.body.error.code).toBe('validation');
  expect(dupes.body.error.message).toContain("Status id 'saved' is used twice.");
});
