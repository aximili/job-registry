import { afterEach, beforeEach, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, EmailStatus, EmailSuggestion } from '../../../shared/contracts/index.ts';
import { FakeMailSource } from '../../../tests/fakes/fake-mail-source.ts';
import { pastedCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';

const fromExtension = { origin: 'moz-extension://8f2c1a7e-0000-4000-8000-000000000000' };
let app: TestApp;
let mail: FakeMailSource;
let jobId: number;

beforeEach(async () => {
  mail = new FakeMailSource();
  app = await createTestApp({
    now: () => new Date('2026-10-29T00:00:00Z'),
    settings: { email: { ...DEFAULT_SETTINGS.email, enabled: true, address: 'me@gmail.com' } },
    secrets: { emailPassword: 'abcdabcdabcdabcd' },
    fakes: { mail },
  });
  const saved = app.services.jobs.save({ capture: pastedCapture('An ad.'), fields: { title: 'Senior Engineer', company: 'Atlassian' }, status: 'applied' });
  if (saved.result !== 'created') throw new Error('not created');
  jobId = saved.job.id;
  mail.add({ from: 'careers@atlassian.com', subject: 'Your application', text: 'Unfortunately not.' });
});
afterEach(async () => {
  await app.cleanup();
});

it('checks, lists and confirms through the API', async () => {
  const checked = await app.request('POST', '/api/v1/email/check', {});
  expect(checked.status, JSON.stringify(checked.body)).toBe(200);
  expect(EmailStatus.parse(checked.body)).toMatchObject({ pending: 1, lastError: null });
  const list = await app.request('GET', '/api/v1/email/suggestions');
  const [card] = EmailSuggestion.array().parse(list.body);
  // The default fake AI names no job, so pick it, as you would on the card.
  const confirmed = await app.request('POST', `/api/v1/email/suggestions/${card!.id}/confirm`, { jobId, status: null });
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.state).toBe('confirmed');
  const again = await app.request('POST', `/api/v1/email/suggestions/${card!.id}/dismiss`, {});
  expect(again.status).toBe(409);
  expect(again.body.error.message).toBe('This email was already handled.');
  expect((await app.request('GET', '/api/v1/email/status')).body.pending).toBe(0);
});

it('only the dashboard can check, test, confirm or dismiss', async () => {
  for (const path of ['/api/v1/email/check', '/api/v1/email/test', '/api/v1/email/suggestions/1/confirm', '/api/v1/email/suggestions/1/dismiss']) {
    const res = await app.request('POST', path, {}, fromExtension);
    expect(res.status, path).toBe(403);
    expect(res.body.error.message).toBe('Only the dashboard can handle email.');
  }
  expect(mail.fetches).toBe(0);
});

it('test connection answers with a sentence, never an HTTP error', async () => {
  mail.fail = new Error('Gmail refused the address or app password.');
  const res = await app.request('POST', '/api/v1/email/test', {});
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: false, detail: 'Gmail refused the address or app password.' });
});

it('a check before Gmail is set up is refused with a plain message', async () => {
  app.services.settings.update({ email: { ...DEFAULT_SETTINGS.email, enabled: false } });
  const res = await app.request('POST', '/api/v1/email/check', {});
  expect(res.status).toBe(400);
  expect(res.body.error.message).toBe('Connect Gmail first: Settings → Email.');
});

it('a confirm with a bad body is refused', async () => {
  const res = await app.request('POST', '/api/v1/email/suggestions/1/confirm', { jobId: 'x' });
  expect(res.status).toBe(400);
});
