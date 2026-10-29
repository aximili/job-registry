// Starts the real app for the browser tests: port 4799, a fresh temporary
// data folder, and the built dashboard. It also starts a small fixture website
// on port 4798 for the "paste a link" tests.
// Run by Playwright (see playwright.config.ts). It isn't part of the app.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { DEFAULT_SETTINGS } from '../../shared/contracts/index.ts';
import { buildApp } from '../../server/app.ts';
import { resolvePaths } from '../../server/core/config.ts';
import { FakeMailSource, type FakeMail } from '../fakes/fake-mail-source.ts';
import { FakeRuntime } from '../fakes/fake-runtime.ts';
import { createSmartFake, E2E_PROFILE, type SmartMode } from '../fakes/smart-fake-ai.ts';

export const E2E_PORT = 4799;
export const FIXTURE_PORT = 4798;

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'jr-e2e-'));
const paths = resolvePaths(root, { webDist: join(projectRoot, 'web', 'dist') });

// A master profile, so saved jobs get a match rating from the fake AI.
mkdirSync(paths.profile, { recursive: true });
writeFileSync(join(paths.profile, 'master-profile.md'), E2E_PROFILE);

const STARTER_FILES = [
  ['resume-guide', 'profile/resume-guide.md'],
  ['cover-letter-guide', 'profile/cover-letter-guide.md'],
  ['resume', 'templates/resume.css'],
  ['cover-letter', 'templates/cover-letter.css'],
] as const;

const smart = createSmartFake();
const runtime = new FakeRuntime();
// A mailbox in memory: tests add emails with POST /__test/mail.
const mail = new FakeMailSource();
const app = await buildApp(
  { paths, port: E2E_PORT, logger: pino({ level: 'warn' }), version: 'e2e' },
  { ai: smart.provider, runtime, mail },
);

// Test-only: empty every table between tests, and put the settings back.
// AI work from the last test is cancelled first: SQLite reuses job ids after
// a delete, so a late answer could otherwise land on the next test's job.
app.http.post('/__test/reset', async () => {
  smart.setMode('smart');
  smart.provider.calls.length = 0;
  smart.provider.finished.length = 0;
  await app.services.ai.stop();
  await app.services.enrich.onIdle();
  mail.messages = [];
  mail.fail = null;
  app.db.exec(`
    DELETE FROM email_suggestions; DELETE FROM email_state;
    DELETE FROM documents; DELETE FROM attachments;
    DELETE FROM interactions; DELETE FROM job_contacts; DELETE FROM notes; DELETE FROM status_history;
    DELETE FROM postings; DELETE FROM contacts; DELETE FROM jobs; DELETE FROM search_index; DELETE FROM rating_cache;`);
  app.services.settings.update(DEFAULT_SETTINGS);
  app.services.settings.updateSecrets({ emailPassword: null });
  // Your profile and templates as a fresh install has them.
  app.services.profile.write('master-profile', E2E_PROFILE);
  app.services.profile.write('preferences', '');
  for (const [name, file] of STARTER_FILES) app.services.profile.write(name, readFileSync(join(projectRoot, 'starters', file), 'utf8'));
  return { ok: true };
});

// Test-only: how many AI calls each task has started, for the extension's
// "only the last rating runs" check.
app.http.get('/__test/ai-calls', async () => ({
  ratings: smart.provider.callsFor('rating').length,
  ratingsFinished: smart.provider.finished.filter((c) => c.jsonSchema?.name === 'rating').length,
}));

// Test-only: the fake mailbox. { messages } adds emails (received now unless
// they say otherwise); { fail } makes Gmail fail with that message, or not.
app.http.post('/__test/mail', async (req) => {
  const body = req.body as { messages?: Omit<FakeMail, 'uid'>[]; fail?: string | null };
  for (const m of body.messages ?? []) mail.add({ receivedAt: new Date().toISOString(), ...m });
  if (body.fail !== undefined) mail.fail = body.fail === null ? null : new Error(body.fail);
  return { ok: true };
});

// Test-only: how the fake AI behaves: { mode: 'smart' | 'fail' | 'slow' | 'bad' }.
app.http.post('/__test/ai', async (req) => {
  smart.setMode((req.body as { mode: SmartMode }).mode);
  return { ok: true };
});

await app.http.listen({ host: '127.0.0.1', port: E2E_PORT });

const fixtures = join(projectRoot, 'tests', 'e2e', 'fixtures');
const sites = join(projectRoot, 'tests', 'fixtures', 'sites');

// Copies of the job sites for the extension's tests, at /seek/…, /linkedin/…,
// /indeed/… and /other/… (the extension's test build reads them as the real sites).
const SITE_PAGES: [RegExp, string][] = [
  [/^\/seek\/jobs$/, join(fixtures, 'seek-live-search.html')],
  [/^\/seek\/job\/99999999$/, join(fixtures, 'seek-unreadable.html')],
  [/^\/seek\/job\/88888888$/, join(fixtures, 'seek-growing.html')],
  [/^\/seek\/job\/\d+$/, join(sites, 'seek-job.html')],
  [/^\/linkedin\/jobs\/view\/\d+\/?$/, join(sites, 'linkedin-job.html')],
  [/^\/indeed\/viewjob$/, join(sites, 'indeed-job.html')],
  [/^\/other\/article$/, join(sites, 'generic-article.html')],
];

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]!;
  const sitePage = SITE_PAGES.find(([pattern]) => pattern.test(path))?.[1];
  if (sitePage) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(sitePage));
    return;
  }
  const name = path.slice(1);
  if (name === 'blocked') {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  const file = join(fixtures, name);
  if (!name || name.includes('..') || !existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(readFileSync(file));
}).listen(FIXTURE_PORT, '127.0.0.1');
