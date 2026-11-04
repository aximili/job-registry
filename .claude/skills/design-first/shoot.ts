/**
 * Screenshots the dashboard for the design-first skill: each page, in light and dark, at two widths.
 *
 *   node .claude/skills/design-first/shoot.ts <name> --out <dir> [--dist <dir>] [--pages home,job]
 *     [--scheme light|dark] [--size desktop|half] [--design <x>] [--selector <css>] [--full]
 *     [--writer claude|missing]
 *
 * It starts its own copy of the app on a free port, with a fresh temporary data folder, a fake AI
 * and a fake mailbox, and fills it with a small job hunt. So it never touches your real data, and
 * never clashes with `npm start` (4777) or `npm run test:e2e` (4799). It stops the app when it ends.
 *
 * It serves the dashboard built into `--dist` (default temp/design-first/dist), not web/dist, so a
 * test run in progress keeps its own build.
 *
 * Pages: home, search, job, board, settings, display, inbox, editor, plus ai-menu (the header's AI
 * switcher, open), ai-cloud (Settings → AI with a cloud AI open), ai-add (adding an AI: Claude
 * picked, its model list open) and ai-problem (the switcher open while the AI has a problem). There are three saved AIs: Bonsai 2 (in use), Bonsai 2B light, and
 * Claude – mine, which has a made-up key. The fake AI answers for all three. And the editor's
 * "Before I write": brief (a new cover letter for a job with a brief, an answer from an earlier
 * brief and a quote not in the ad), brief-making (a brief part-way through being made) and
 * brief-written (a cover letter with text, beside its brief).
 * starter is Settings → Profile with a cover letter guide you've changed, so the "newer starter
 * guide" note shows; starter-diff is the same with See what changes pressed.
 * prep is the job page's "Get ready" with a plan (and an earlier one), for the Medibank job;
 * prep-making is the main job's, part-way through making one.
 *
 * Writes `<dir>/<name>-<page>-<scheme>-<size>.png` and prints each path.
 * `--design <x>` sets data-design="<x>" on <html>, for options built as `:root[data-design='x']`.
 * `--selector` shoots that element (the first match) instead of the window. `--full` shoots the whole page.
 * `--writer claude` makes Claude – mine the AI that writes your documents (by default the AI in use
 * writes). `--writer missing` shows the dashboard a writing AI that isn't saved any more, as a hand
 * edit of settings.json can leave it, so the fallback sentence shows.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { firefox, type Page } from '@playwright/test';
import { pino } from 'pino';

import { buildApp } from '../../../server/app.ts';
import { resolvePaths } from '../../../server/core/config.ts';
import { newSavedAi, type Settings } from '../../../shared/contracts/index.ts';
import { localDate } from '../../../shared/dates.ts';
import { FakeMailSource } from '../../../tests/fakes/fake-mail-source.ts';
import { FakeRuntime } from '../../../tests/fakes/fake-runtime.ts';
import { createSmartFake, E2E_PROFILE } from '../../../tests/fakes/smart-fake-ai.ts';
import { FAKE_BRIEF } from '../../../tests/fakes/fake-ai-provider.ts';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));

// "half" is a window snapped to half of a 1920-wide screen, where layouts break first.
const SIZES = {
  desktop: { width: 1440, height: 900 },
  half: { width: 960, height: 1000 },
} as const;
const SCHEMES = ['light', 'dark'] as const;
const PAGES = ['home', 'search', 'job', 'board', 'settings', 'display', 'inbox', 'editor', 'ai-menu', 'ai-cloud', 'ai-add', 'ai-problem', 'brief', 'brief-making', 'brief-written', 'starter', 'starter-diff', 'prep', 'prep-making'] as const;
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
const writer = flag('--writer');
const pages = (flag('--pages')?.split(',') ?? PAGES) as PageName[];
const schemes = flag('--scheme') ? [flag('--scheme') as (typeof SCHEMES)[number]] : SCHEMES;
const sizes = flag('--size') ? [flag('--size') as keyof typeof SIZES] : (Object.keys(SIZES) as (keyof typeof SIZES)[]);

if (!name || name.startsWith('--') || !outDir) {
  console.error(
    'Usage: shoot.ts <name> --out <dir> [--dist <dir>] [--pages home,job] [--scheme light|dark] [--size desktop|half] [--design <x>] [--selector <css>] [--full] [--writer claude|missing]',
  );
  process.exit(1);
}
const unknown = pages.filter((p) => !PAGES.includes(p));
if (unknown.length) {
  console.error(`Unknown page: ${unknown.join(', ')}. Pages: ${PAGES.join(', ')}.`);
  process.exit(1);
}
if (writer !== undefined && writer !== 'claude' && writer !== 'missing') {
  console.error('--writer is claude or missing.');
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

// The starter cover letter guide as you might have changed it: two lines of
// an older starter, a sign-off of your own, and one rule you added at the end.
function changedGuide(): string {
  const starter = readFileSync(join(projectRoot, 'starters', 'profile', 'cover-letter-guide.md'), 'utf8');
  return (
    starter
      .replace("- It opens with the ad's most telling line, and why it fits me.", "- It shows, in the first two sentences, why I match this job's biggest need.")
      .replace(/^When an approved brief is given, .*$/m, 'Keep the plan short: one line per item.')
      .replace('7. `Kind regards,`', '7. `Warm regards,`')
      .trimEnd() + '\n- Sign off with my first name only.\n'
  );
}

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

  const settings = await send<Settings>('GET', '/api/v1/settings');
  await send('PATCH', '/api/v1/settings', { email: { ...settings.email, enabled: true, address: 'alex@gmail.com' } });

  // Three saved AIs: Bonsai 2 in use, a lighter copy that runs the 2B model,
  // and a cloud AI with a made-up key (the fake AI answers for every one).
  const bonsai = settings.ai.saved[0]!;
  const args = [...bonsai.managed.args];
  args[args.indexOf('-m') + 1] = 'ai/models/Ternary-Bonsai-2-2B-PQ2_0.gguf';
  const light = { ...newSavedAi('llama-server', 'Bonsai 2B light', [bonsai.id]), managed: { ...bonsai.managed, args } };
  const claude = newSavedAi('anthropic', 'Claude – mine', [bonsai.id, light.id]);
  await send('PATCH', '/api/v1/settings', { ai: { active: bonsai.id, saved: [bonsai, light, claude] } });
  await send('PUT', '/api/v1/settings/secrets', { aiKeys: { [claude.id]: 'sk-ant-design-only-not-a-real-key' } });
  if (writer === 'claude') await send('PUT', '/api/v1/settings/ai/writer', { id: claude.id });
  await send('PUT', '/api/v1/settings/secrets', { emailPassword: 'abcdefghijklmnop' });
  const now = new Date().toISOString();
  mail.add({ receivedAt: now, from: 'careers@canva.com', subject: 'Your application for Platform Engineer', text: 'Unfortunately we will not progress your application.' });
  mail.add({ receivedAt: now, from: 'priya.shah@atlassian.com', subject: 'Senior Software Engineer: next steps', text: 'We would like to invite you to a second interview next Tuesday.' });
  await send('POST', '/api/v1/email/check', {});

  return { jobId: main, docId: doc.id };
}

// The editor's "Before I write" (brief, brief-making, brief-written): only when
// one of those pages is shot, so the other pages stay as they were. The main
// job gets a brief, then a second one that carries an answer you gave in the
// first (and added to your profile); its quote isn't in the ad, so the
// warning shows; one need is dropped and one question skipped. A cover letter
// with text, for the editor once you've written. Returns that letter, and a
// job with no brief yet.
async function seedBrief(origin: string, jobId: number): Promise<{ letterId: number; freshJobId: number }> {
  const send = async (method: string, path: string, data?: unknown): Promise<string> => {
    const res = await fetch(origin + path, {
      method,
      headers: { origin, 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
    return res.text();
  };
  type B = { id: number; needs: { chosen: number; dropped: boolean }[]; questions: { answer: string | null; skipped: boolean; addToProfile: boolean }[] };
  const make = async (): Promise<B> => {
    const lines = (await send('POST', `/api/v1/jobs/${jobId}/brief`, {})).trim().split('\n').map((l) => JSON.parse(l) as { kind: string; brief?: B });
    const done = lines.find((l) => l.kind === 'done');
    if (!done?.brief) throw new Error(`No brief was made: ${JSON.stringify(lines.at(-1))}`);
    return done.brief;
  };
  // A quote that isn't word for word in the ad.
  const plain = smart.provider.reply;
  smart.provider.reply = (req) => (req.jsonSchema?.name === 'brief' ? JSON.stringify(FAKE_BRIEF) : plain(req));
  const first = await make();
  const answer = (q: B['questions'][number], i: number) =>
    i === 0 ? { answer: 'Yes: a small command-line tool in Go, last year.', skipped: false, addToProfile: true } : { answer: q.answer, skipped: q.skipped, addToProfile: q.addToProfile };
  await send('PATCH', `/api/v1/briefs/${first.id}`, { questions: first.questions.map(answer) });
  await send('POST', `/api/v1/briefs/${first.id}/answers-to-profile`, {});
  const second = await make();
  await send('PATCH', `/api/v1/briefs/${second.id}`, {
    needs: second.needs.map((n, i) => ({ chosen: n.chosen, dropped: i === 2 })),
    questions: second.questions.map((q, i) => ({ answer: q.answer, skipped: i === 1, addToProfile: q.addToProfile })),
  });
  const letter = JSON.parse(
    await send('POST', `/api/v1/jobs/${jobId}/documents`, {
      kind: 'cover_letter',
      markdown: 'Dear Alex,\n\nYou want engineers who ship faster. At Example Co I cut build times by 30%.\n\nKind regards,\nSam Taylor',
      origin: 'generated',
    }),
  ) as { id: number };
  const jobs = JSON.parse(await send('GET', '/api/v1/jobs')) as { id: number; company: string | null }[];
  return { letterId: letter.id, freshJobId: jobs.find((j) => j.company === 'Canva')!.id };
}

// The job page's "Get ready" (prep): only when it's shot, so the other pages
// stay as they were. The Medibank job gets two plans from the fake AI: the
// newest shows, the other is under Earlier plans. Returns that job.
async function seedPrep(origin: string): Promise<number> {
  const send = async (method: string, path: string): Promise<string> => {
    const res = await fetch(origin + path, { method, headers: { origin, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
    return res.text();
  };
  const jobs = JSON.parse(await send('GET', '/api/v1/jobs')) as { id: number; company: string | null }[];
  const id = jobs.find((j) => j.company === 'Medibank')!.id;
  for (let i = 0; i < 2; i++) {
    const last = (await send('POST', `/api/v1/jobs/${id}/prep`)).trim().split('\n').at(-1)!;
    if ((JSON.parse(last) as { kind: string }).kind !== 'done') throw new Error(`No plan was made: ${last}`);
  }
  return id;
}

// What each page shows once it has loaded its data.
async function ready(page: Page, which: PageName, origin: string, jobId: number): Promise<void> {
  const wait = {
    home: () => page.getByText('Atlassian').first().waitFor(),
    // Typing in the search box swaps the home page for the results.
    search: async () => {
      await page.getByRole('combobox', { name: 'Search jobs' }).fill('engineer');
      await page.getByRole('option').first().waitFor();
    },
    job: () => page.getByRole('region', { name: 'Call sheet' }).waitFor(),
    board: () => page.getByRole('heading', { name: 'Board' }).waitFor(),
    settings: async () => {
      await page.getByRole('heading', { name: 'AI', exact: true }).first().waitFor();
      // Firefox can scroll the focused heading to the top a moment after it loads; shoot the top.
      await page.waitForTimeout(300);
      await page.evaluate(() => scrollTo(0, 0));
    },
    display: () => page.getByRole('heading', { name: 'Display', exact: true }).waitFor(),
    inbox: () => page.getByRole('article').first().waitFor(),
    editor: () => page.locator('iframe').first().waitFor(),
    'ai-menu': async () => {
      await page.getByText('Atlassian').first().waitFor();
      await page.getByRole('button', { name: /AI in use$/ }).click();
      await page.getByRole('menu').waitFor();
    },
    'ai-cloud': async () => {
      await page.getByRole('heading', { name: 'AI', exact: true }).first().waitFor();
      await page.getByRole('button', { name: /^Claude – mine/ }).first().click();
      await page.getByRole('heading', { name: 'Claude – mine', exact: true }).waitFor();
    },
    'ai-add': async () => {
      await page.getByRole('heading', { name: 'AI', exact: true }).first().waitFor();
      await page.getByRole('button', { name: 'Add an AI' }).click();
      await page.getByLabel('Provider').selectOption('anthropic');
      await page.getByRole('button', { name: 'Show the list' }).click();
      await page.getByRole('listbox').waitFor();
      await page.getByText(/^Asking /).waitFor({ state: 'detached' });
    },
    // The AI can't be reached: a job is read again, and fails.
    'ai-problem': async () => {
      await page.getByText('Atlassian').first().waitFor();
      smart.setMode('fail');
      await fetch(`${origin}/api/v1/jobs/${jobId}/reparse`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
      await page.getByRole('button', { name: /, problem, AI in use$/ }).waitFor();
      await page.getByRole('button', { name: /AI in use$/ }).click();
      await page.getByRole('menu').waitFor();
    },
    brief: () => page.getByRole('heading', { name: 'Before I write' }).waitFor(),
    // A job with no brief: the main button makes one, and the AI takes its
    // time, so the shot is part-way through.
    'brief-making': async () => {
      await page.getByRole('heading', { name: 'Before I write' }).waitFor();
      smart.provider.delayMs = 60_000;
      await page.getByRole('button', { name: /^Write the / }).click();
      await page.getByText(/is making the brief/).waitFor();
      await page.waitForTimeout(2_200);
    },
    'brief-written': () => page.locator('iframe').first().waitFor(),
    // Settings → Profile, with the note for the changed cover letter guide.
    starter: async () => {
      await page.getByRole('textbox', { name: 'Cover letter guide' }).waitFor();
      await page.waitForTimeout(300);
      await page.evaluate(() => scrollTo(0, 0));
    },
    // The same, with See what changes pressed (when there is one) and the note in view.
    'starter-diff': async () => {
      await page.getByRole('textbox', { name: 'Cover letter guide' }).waitFor();
      const see = page.getByRole('button', { name: 'See what changes' });
      if (await see.count()) {
        await see.first().click();
        await see.first().evaluate((el) => el.closest('section')?.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => scrollBy(0, -16));
      }
    },
    // Get ready, scrolled into view: a plan, or one part-way through (the AI
    // takes its time, and the shot is part-way).
    prep: async () => {
      await page.getByText(/^Made by /).waitFor();
      await page.getByRole('heading', { name: 'Get ready' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => scrollBy(0, -24));
    },
    'prep-making': async () => {
      await page.getByRole('button', { name: 'Get ready' }).waitFor();
      smart.provider.delayMs = 60_000;
      await page.getByRole('button', { name: 'Get ready' }).click();
      await page.getByText(/is making your plan/).waitFor();
      await page.waitForTimeout(2_200);
      await page.getByRole('heading', { name: 'Get ready' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => scrollBy(0, -24));
    },
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
// A cover letter guide you changed, so Settings → Profile offers the newer starter.
writeFileSync(join(paths.profile, 'cover-letter-guide.md'), changedGuide());

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
  const briefs = pages.some((p) => p.startsWith('brief')) ? await seedBrief(origin, jobId) : null;
  const prepJobId = pages.includes('prep') ? await seedPrep(origin) : null;
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
    'ai-menu': '/',
    'ai-cloud': '/settings#ai',
    'ai-add': '/settings#ai',
    'ai-problem': '/',
    brief: `/jobs/${jobId}/documents/new?kind=cover_letter`,
    'brief-making': `/jobs/${briefs?.freshJobId}/documents/new?kind=cover_letter`,
    'brief-written': `/jobs/${jobId}/documents/${briefs?.letterId}`,
    starter: '/settings#profile',
    'starter-diff': '/settings#profile',
    prep: `/jobs/${prepJobId}`,
    'prep-making': `/jobs/${jobId}`,
  };

  for (const scheme of schemes) {
    for (const size of sizes) {
      const context = await browser.newContext({ viewport: SIZES[size], colorScheme: scheme });
      if (design) await context.addInitScript((d) => document.documentElement.setAttribute('data-design', d), design);
      // The server never keeps a writer that isn't saved, so the page is shown one.
      if (writer === 'missing') {
        await context.route('**/api/v1/settings', async (route) => {
          if (route.request().method() !== 'GET') return route.continue();
          const res = await route.fetch();
          const settings = (await res.json()) as Settings;
          await route.fulfill({ response: res, json: { ...settings, ai: { ...settings.ai, writer: 'an-old-ai' } } });
        });
      }
      const page = await context.newPage();
      for (const which of pages) {
        // A fresh load each time: two pages at one address would otherwise share what's typed.
        await page.goto('about:blank');
        await page.goto(origin + urls[which], { waitUntil: 'load' });
        await ready(page, which, origin, jobId);
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
        // Back to an AI that works, for the pages after.
        if (which === 'brief-making') smart.provider.delayMs = 0;
        // Cancel, so the main job stays without a plan.
        if (which === 'prep-making') {
          await page.getByRole('button', { name: 'Cancel' }).click();
          smart.provider.delayMs = 0;
        }
        if (which === 'ai-problem') {
          smart.setMode('smart');
          await fetch(`${origin}/api/v1/ai/test`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
