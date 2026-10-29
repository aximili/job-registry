/**
 * Screenshots the dashboard for the design-first skill: each page, in light and dark, at two widths.
 *
 *   node .claude/skills/design-first/shoot.ts <name> --out <dir> [--dist <dir>] [--pages home,job]
 *     [--scheme light|dark] [--size desktop|half] [--design <x>] [--selector <css>] [--full]
 *
 * It starts its own copy of the app on a free port, with a fresh temporary data folder, a fake AI
 * and a fake mailbox, and fills it with a small job hunt. So it never touches your real data, and
 * never clashes with `npm start` (4777) or `npm run test:e2e` (4799). It stops the app when it ends.
 *
 * It serves the dashboard built into `--dist` (default temp/design-first/dist), not web/dist, so a
 * test run in progress keeps its own build.
 *
 * Writes `<dir>/<name>-<page>-<scheme>-<size>.png` and prints each path.
 * `--design <x>` sets data-design="<x>" on <html>, for options built as `:root[data-design='x']`.
 * `--selector` shoots that element (the first match) instead of the window. `--full` shoots the whole page.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { firefox, type Page } from '@playwright/test';
import { pino } from 'pino';

import { buildApp } from '../../../server/app.ts';
import { resolvePaths } from '../../../server/core/config.ts';
import { localDate } from '../../../shared/dates.ts';
import { FakeMailSource } from '../../../tests/fakes/fake-mail-source.ts';
import { FakeRuntime } from '../../../tests/fakes/fake-runtime.ts';
import { createSmartFake, E2E_PROFILE } from '../../../tests/fakes/smart-fake-ai.ts';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));

// "half" is a window snapped to half of a 1920-wide screen, where layouts break first.
const SIZES = {
  desktop: { width: 1440, height: 900 },
  half: { width: 960, height: 1000 },
} as const;
const SCHEMES = ['light', 'dark'] as const;
const PAGES = ['home', 'search', 'job', 'board', 'settings', 'display', 'inbox', 'editor'] as const;
type PageName = (typeof PAGES)[number];

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const name = args[0];
const outDir = flag('--out');
const dist = resolve(flag('--dist') ?? join(projectRoot, 'temp', 'design-first', 'dist'));
const design = flag('--design');
const selector = flag('--selector');
const full = args.includes('--full');
const pages = (flag('--pages')?.split(',') ?? PAGES) as PageName[];
const schemes = flag('--scheme') ? [flag('--scheme') as (typeof SCHEMES)[number]] : SCHEMES;
const sizes = flag('--size') ? [flag('--size') as keyof typeof SIZES] : (Object.keys(SIZES) as (keyof typeof SIZES)[]);

if (!name || name.startsWith('--') || !outDir) {
  console.error('Usage: shoot.ts <name> --out <dir> [--dist <dir>] [--pages home,job] [--scheme light|dark] [--size desktop|half] [--design <x>] [--selector <css>] [--full]');
  process.exit(1);
}
const unknown = pages.filter((p) => !PAGES.includes(p));
if (unknown.length) {
  console.error(`Unknown page: ${unknown.join(', ')}. Pages: ${PAGES.join(', ')}.`);
  process.exit(1);
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`No dashboard build in ${dist}. Build it first:\n  npm run build -- --outDir "${dist}"`);
  process.exit(1);
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });
}

// A local date some days from today.
function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localDate(d);
}

const AD = `About the role
We're looking for an engineer to join a small team building the tools our customers use every day.

What you'll do
- Design, build and run services in TypeScript and Node.js
- Work closely with design and product
- Help the team ship small changes often

About you
- Five or more years building web apps
- Comfortable with SQL and cloud hosting
- Clear writing, and kind code reviews

Hybrid, three days in the office. Salary $160k to $180k plus super.`;

const RESUME = `# Alex Taylor

Senior software engineer · Sydney NSW · alex@example.com

## Summary
Eight years building web apps in TypeScript and Node.js, most recently leading a team of four.

## Experience
### Lead Engineer, Example Co (2021 to now)
- Led the move to a new billing system, with no downtime
- Cut page load time by 40 per cent
`;

// A small, believable job hunt: every status group, a call, notes, follow-ups, a sent resume and two emails.
async function seed(origin: string, mail: FakeMailSource): Promise<{ jobId: number; docId: number }> {
  const send = async <T>(method: string, path: string, data?: unknown): Promise<T> => {
    const res = await fetch(origin + path, {
      method,
      headers: { origin, 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const job = async (f: { title: string; company?: string; agency?: string; location: string; status: string }) =>
    (
      await send<{ job: { id: number } }>('POST', '/api/v1/jobs', {
        capture: { sourceUrl: null, canonicalUrl: null, sourceSite: 'pasted', externalId: null, jdText: AD, capturedAt: new Date().toISOString() },
        fields: { title: f.title, location: f.location, ...(f.company ? { company: f.company } : {}), ...(f.agency ? { agency: f.agency } : {}) },
        status: f.status,
        decision: 'new',
      })
    ).job.id;

  const main = await job({ title: 'Senior Software Engineer', company: 'Atlassian', location: 'Sydney NSW', status: 'interview_1' });
  const canva = await job({ title: 'Platform Engineer', company: 'Canva', location: 'Sydney NSW', status: 'applied' });
  await job({ title: 'Lead Developer', company: 'Medibank', agency: 'Hays', location: 'Melbourne VIC', status: 'screening' });
  await job({ title: 'Backend Engineer', company: 'REA Group', location: 'Melbourne VIC', status: 'saved' });
  await job({ title: 'Staff Engineer', company: 'Xero', location: 'Remote', status: 'offer' });
  await job({ title: 'DevOps Engineer', company: 'Telstra', location: 'Brisbane QLD', status: 'applied' });
  await job({ title: 'Software Engineer', company: 'Commonwealth Bank', location: 'Sydney NSW', status: 'rejected' });
  await job({ title: 'Full Stack Developer', company: 'Seek', location: 'Melbourne VIC', status: 'no_response' });

  await send('POST', '/api/v1/interactions', {
    newContact: { name: 'Priya Shah', phone: '0412 345 678' },
    jobId: main,
    notes: 'Recruiter call. Team of six, hybrid. Second round is a pairing session next week.',
  });
  await send('POST', `/api/v1/jobs/${main}/notes`, { body: 'Ask about the on-call roster and the salary band.' });
  await send('PUT', `/api/v1/jobs/${main}/follow-up`, { on: day(-1), note: 'Email Priya if no date for round two' });
  await send('PUT', `/api/v1/jobs/${canva}/follow-up`, { on: day(3) });
  const doc = await send<{ id: number }>('POST', `/api/v1/jobs/${main}/documents`, { kind: 'resume', markdown: RESUME, origin: 'edited' });
  await send('POST', `/api/v1/documents/${doc.id}/sent`, {});

  const settings = await send<{ email: Record<string, unknown> }>('GET', '/api/v1/settings');
  await send('PATCH', '/api/v1/settings', { email: { ...settings.email, enabled: true, address: 'alex@gmail.com' } });
  await send('PUT', '/api/v1/settings/secrets', { emailPassword: 'abcdefghijklmnop' });
  const now = new Date().toISOString();
  mail.add({ receivedAt: now, from: 'careers@canva.com', subject: 'Your application for Platform Engineer', text: 'Unfortunately we will not progress your application.' });
  mail.add({ receivedAt: now, from: 'priya.shah@atlassian.com', subject: 'Senior Software Engineer: next steps', text: 'We would like to invite you to a second interview next Tuesday.' });
  await send('POST', '/api/v1/email/check', {});

  return { jobId: main, docId: doc.id };
}

// What each page shows once it has loaded its data.
async function ready(page: Page, which: PageName): Promise<void> {
  const wait = {
    home: () => page.getByText('Atlassian').first().waitFor(),
    // Typing in the search box swaps the home page for the results.
    search: async () => {
      await page.getByRole('combobox', { name: 'Search jobs' }).fill('engineer');
      await page.getByRole('option').first().waitFor();
    },
    job: () => page.getByRole('region', { name: 'Call sheet' }).waitFor(),
    board: () => page.getByRole('heading', { name: 'Board' }).waitFor(),
    settings: () => page.getByRole('heading', { name: 'AI', exact: true }).first().waitFor(),
    display: () => page.getByRole('heading', { name: 'Display', exact: true }).waitFor(),
    inbox: () => page.getByRole('article').first().waitFor(),
    editor: () => page.locator('iframe').first().waitFor(),
  }[which];
  await wait();
  await page.evaluate(() => document.fonts.ready);
  // The editor's preview redraws 300 ms after it loads.
  await page.waitForTimeout(400);
}

mkdirSync(outDir, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'jr-design-'));
const paths = resolvePaths(root, { webDist: dist });
mkdirSync(paths.profile, { recursive: true });
writeFileSync(join(paths.profile, 'master-profile.md'), E2E_PROFILE);

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const smart = createSmartFake();
const mail = new FakeMailSource();
const app = await buildApp(
  { paths, port, logger: pino({ level: 'warn' }), version: 'design' },
  { ai: smart.provider, runtime: new FakeRuntime(), mail },
);
await app.http.listen({ host: '127.0.0.1', port });

const browser = await firefox.launch();
try {
  const { jobId, docId } = await seed(origin, mail);
  // Ratings and parsed fields come from the fake AI after a save; wait so they show.
  await app.services.enrich.onIdle();
  const urls: Record<PageName, string> = {
    home: '/',
    search: '/',
    job: `/jobs/${jobId}`,
    board: '/board',
    settings: '/settings#ai',
    display: '/settings#display',
    inbox: '/inbox',
    editor: `/jobs/${jobId}/documents/${docId}`,
  };

  for (const scheme of schemes) {
    for (const size of sizes) {
      const context = await browser.newContext({ viewport: SIZES[size], colorScheme: scheme });
      if (design) await context.addInitScript((d) => document.documentElement.setAttribute('data-design', d), design);
      const page = await context.newPage();
      for (const which of pages) {
        await page.goto(origin + urls[which], { waitUntil: 'load' });
        await ready(page, which);
        // The pointer rests where the last click left it, and a hover there changes a row.
        await page.mouse.move(0, 0);
        const path = join(outDir, `${name}-${which}-${scheme}-${size}.png`);
        if (selector) {
          const target = page.locator(selector).first();
          await target.scrollIntoViewIfNeeded();
          await target.screenshot({ path, animations: 'disabled' });
        } else {
          await page.screenshot({ path, animations: 'disabled', fullPage: full });
        }
        console.log(path);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
