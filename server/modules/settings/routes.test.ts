import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { activeAi, DEFAULT_SETTINGS, DEFAULT_STATUSES } from '../../../shared/contracts/index.ts';
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
  const bonsai = activeAi(DEFAULT_SETTINGS.ai);
  const withAi = (changes: object) => ({ ai: { active: bonsai.id, saved: [{ ...bonsai, ...changes }] } });
  const evil = withAi({ managed: { ...bonsai.managed, exe: 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', args: ['-c', 'calc'] } });
  const res = await app.request('PATCH', '/api/v1/settings', evil, fromExtension);
  expect(res.status).toBe(403);
  expect(res.body.error).toEqual({ code: 'forbidden', message: 'Only the dashboard can change settings.' });
  expect(activeAi(app.services.settings.get().ai).managed.exe).toBe('ai/llama.cpp/llama-server.exe');

  const chrome = await app.request('PATCH', '/api/v1/settings', withAi({ baseUrl: 'https://example.com/v1' }), { origin: 'chrome-extension://abc' });
  expect(chrome.status).toBe(403);

  // The dashboard still can, and extensions can still read.
  expect((await app.request('PATCH', '/api/v1/settings', withAi({ model: 'qwen3:8b' }))).status).toBe(200);
  expect((await app.request('GET', '/api/v1/settings', undefined, fromExtension)).status).toBe(200);
});

it('the app password is never sent back, and only the dashboard can set it', async () => {
  const settings = await app.request('GET', '/api/v1/settings');
  expect(settings.body.email).toEqual({
    enabled: false,
    address: '',
    host: 'imap.gmail.com',
    port: 993,
    mailbox: 'INBOX',
    pollMinutes: 10,
    firstCheckDays: 14,
    maxPerCheck: 100,
  });
  expect((await app.request('GET', '/api/v1/settings/secrets')).body).toEqual({ emailPassword: false, aiKeys: [] });

  const fromExtension = await app.request('PUT', '/api/v1/settings/secrets', { emailPassword: 'abcdefghijklmnop' }, {
    origin: 'moz-extension://8f2c1a7e-0000-4000-8000-000000000000',
  });
  expect(fromExtension.status).toBe(403);
  expect(app.services.settings.emailPassword()).toBeNull();

  const saved = await app.request('PUT', '/api/v1/settings/secrets', { emailPassword: 'abcdefghijklmnop' });
  expect(saved.status).toBe(200);
  expect(saved.body).toEqual({ emailPassword: true, aiKeys: [] });
  expect(JSON.stringify(saved.body)).not.toContain('abcdefghijklmnop');
  const again = await app.request('GET', '/api/v1/settings');
  expect(JSON.stringify(again.body)).not.toContain('abcdefghijklmnop');
  expect((await app.request('GET', '/api/v1/settings/secrets')).body).toEqual({ emailPassword: true, aiKeys: [] });
});

const fromExtension = { origin: 'moz-extension://8f2c1a7e-0000-4000-8000-000000000000' };
const claude = { ...activeAi(DEFAULT_SETTINGS.ai), id: 'claude-mine', name: 'Claude – mine', preset: 'custom', baseUrl: 'https://api.example.com/v1' };

it('only the dashboard can switch the AI in use', async () => {
  await app.request('PATCH', '/api/v1/settings', { ai: { active: 'bonsai-2', saved: [activeAi(DEFAULT_SETTINGS.ai), claude] } });

  const refused = await app.request('PUT', '/api/v1/settings/ai/active', { id: 'claude-mine' }, fromExtension);
  expect(refused.status).toBe(403);
  expect(refused.body.error).toEqual({ code: 'forbidden', message: 'Only the dashboard can change settings.' });
  expect(app.services.settings.get().ai.active).toBe('bonsai-2');

  const switched = await app.request('PUT', '/api/v1/settings/ai/active', { id: 'claude-mine' });
  expect(switched.status).toBe(200);
  expect(switched.body.ai.active).toBe('claude-mine');
  expect((await app.request('GET', '/api/v1/settings')).body.ai.active).toBe('claude-mine');

  const unknown = await app.request('PUT', '/api/v1/settings/ai/active', { id: 'nope' });
  expect(unknown.status).toBe(400);
  expect(unknown.body.error).toEqual({ code: 'validation', message: "There's no saved AI with the id 'nope'." });
  expect((await app.request('PUT', '/api/v1/settings/ai/active', { id: 'Not An Id' })).status).toBe(400);
});

it('an API key is never sent back, and only the dashboard can set it', async () => {
  await app.request('PATCH', '/api/v1/settings', { ai: { active: 'bonsai-2', saved: [activeAi(DEFAULT_SETTINGS.ai), claude] } });

  const refused = await app.request('PUT', '/api/v1/settings/secrets', { aiKeys: { 'claude-mine': 'sk-ant-123' } }, fromExtension);
  expect(refused.status).toBe(403);
  expect(app.services.settings.aiKey('claude-mine')).toBeNull();

  const saved = await app.request('PUT', '/api/v1/settings/secrets', { aiKeys: { 'claude-mine': ' sk-ant-123\n' } });
  expect(saved.status).toBe(200);
  expect(saved.body).toEqual({ emailPassword: false, aiKeys: ['claude-mine'] });
  expect(app.services.settings.aiKey('claude-mine')).toBe('sk-ant-123');
  for (const url of ['/api/v1/settings', '/api/v1/settings/secrets']) {
    expect(JSON.stringify((await app.request('GET', url)).body)).not.toContain('sk-ant-123');
  }

  // A key for an AI that isn't saved is refused, and the message never holds the key.
  const unknown = await app.request('PUT', '/api/v1/settings/secrets', { aiKeys: { claude: 'sk-ant-456' } });
  expect(unknown.status).toBe(400);
  expect(JSON.stringify(unknown.body)).not.toContain('sk-ant-456');
});

it("a PATCH that changes an AI's provider deletes its key, whatever the browser knew", async () => {
  const bonsai = activeAi(DEFAULT_SETTINGS.ai);
  await app.request('PATCH', '/api/v1/settings', { ai: { active: 'bonsai-2', saved: [bonsai, claude] } });
  await app.request('PUT', '/api/v1/settings/secrets', { aiKeys: { 'claude-mine': 'sk-ant-123' } });
  const moved = { ...claude, preset: 'openai', baseUrl: 'https://api.openai.com/v1' };
  expect((await app.request('PATCH', '/api/v1/settings', { ai: { active: 'bonsai-2', saved: [bonsai, moved] } })).status).toBe(200);
  expect(app.services.settings.aiKey('claude-mine')).toBeNull();
  expect((await app.request('GET', '/api/v1/settings/secrets')).body).toEqual({ emailPassword: false, aiKeys: [] });
});

it('a settings change in the older one-AI shape is refused, and changes nothing', async () => {
  await app.request('PATCH', '/api/v1/settings', { ai: { active: 'bonsai-2', saved: [activeAi(DEFAULT_SETTINGS.ai), claude] } });
  await app.request('PUT', '/api/v1/settings/secrets', { aiKeys: { 'claude-mine': 'sk-ant-123' } });
  for (const ai of [{ model: 'qwen3:8b' }, {}]) {
    const res = await app.request('PATCH', '/api/v1/settings', { ai });
    expect(res.status, JSON.stringify(ai)).toBe(400);
    expect(res.body.error.code).toBe('validation');
  }
  expect(app.services.settings.get().ai.saved.map((a) => a.id)).toEqual(['bonsai-2', 'claude-mine']);
  expect(app.services.settings.aiKey('claude-mine')).toBe('sk-ant-123');
});

it('a key sent where an AI id goes is never quoted back', async () => {
  const res = await app.request('PUT', '/api/v1/settings/secrets', { aiKeys: { 'sk-ant-API03_Secret': 'claude-mine' } });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('validation');
  expect(JSON.stringify(res.body)).not.toContain('sk-ant-API03_Secret');
  expect(res.body.error.message).toBe("An API key was sent for an AI id that isn't valid.");

  // A DeepSeek or Qwen key (sk- and 32 lower-case hex characters) is a valid id, but not a saved AI.
  const hexKey = 'sk-0123456789abcdef0123456789abcdef';
  const valid = await app.request('PUT', '/api/v1/settings/secrets', { aiKeys: { [hexKey]: 'claude-mine' } });
  expect(valid.status).toBe(400);
  expect(JSON.stringify(valid.body)).not.toContain(hexKey);
  expect(valid.body.error.message).toBe("There's no saved AI for this key. Save the AI first, then its key.");
});

it('the secrets list names only saved AIs, even if secrets.json still has a key for one removed by hand', async () => {
  await app.request('PATCH', '/api/v1/settings', { ai: { active: 'bonsai-2', saved: [activeAi(DEFAULT_SETTINGS.ai), claude] } });
  writeFileSync(join(app.root, 'config', 'secrets.json'), JSON.stringify({ aiKeys: { 'claude-mine': 'sk-ant-123', 'claude-gone': 'sk-ant-456' } }));
  expect((await app.request('GET', '/api/v1/settings/secrets')).body).toEqual({ emailPassword: false, aiKeys: ['claude-mine'] });
});
