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

it("only the dashboard can change settings, so an extension can't pick which program the app runs or where the AI is", async () => {
  const fromExtension = { origin: 'moz-extension://8f2c1a7e-0000-4000-8000-000000000000' };
  const evil = { ai: { managed: { exe: 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', args: ['-c', 'calc'] } } };
  const res = await app.request('PATCH', '/api/v1/settings', evil, fromExtension);
  expect(res.status).toBe(403);
  expect(res.body.error).toEqual({ code: 'forbidden', message: 'Only the dashboard can change settings.' });
  expect(app.services.settings.get().ai.managed.exe).toBe('ai/llama.cpp/llama-server.exe');

  const chrome = await app.request('PATCH', '/api/v1/settings', { ai: { baseUrl: 'https://example.com/v1' } }, { origin: 'chrome-extension://abc' });
  expect(chrome.status).toBe(403);

  // The dashboard still can, and extensions can still read.
  expect((await app.request('PATCH', '/api/v1/settings', { ai: { model: 'qwen3:8b' } })).status).toBe(200);
  expect((await app.request('GET', '/api/v1/settings', undefined, fromExtension)).status).toBe(200);
});
