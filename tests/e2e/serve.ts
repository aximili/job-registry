// Starts the real app for the browser tests: port 4799, a fresh temporary
// data folder, and the built dashboard. It also starts a small fixture website
// on port 4798 for the "paste a link" tests.
// Run by Playwright (see playwright.config.ts). It isn't part of the app.

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { DEFAULT_SETTINGS } from '../../shared/contracts/index.ts';
import { buildApp } from '../../server/app.ts';
import { resolvePaths } from '../../server/core/config.ts';

export const E2E_PORT = 4799;
export const FIXTURE_PORT = 4798;

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'jr-e2e-'));
const paths = resolvePaths(root, { webDist: join(projectRoot, 'web', 'dist') });

const app = await buildApp({ paths, port: E2E_PORT, logger: pino({ level: 'warn' }), version: 'e2e' });

// Test-only: empty every table between tests, and put the settings back.
app.http.post('/__test/reset', async () => {
  app.db.exec(`
    DELETE FROM interactions; DELETE FROM job_contacts; DELETE FROM notes; DELETE FROM status_history;
    DELETE FROM postings; DELETE FROM contacts; DELETE FROM jobs; DELETE FROM search_index;`);
  app.services.settings.update(DEFAULT_SETTINGS);
  return { ok: true };
});

await app.http.listen({ host: '127.0.0.1', port: E2E_PORT });

const fixtures = join(projectRoot, 'tests', 'e2e', 'fixtures');
createServer((req, res) => {
  const name = (req.url ?? '/').split('?')[0]!.slice(1);
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
