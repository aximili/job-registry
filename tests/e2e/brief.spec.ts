// The editor's "Before I write": the main button makes a brief, you check it
// (swap a story, drop a need, answer one question and skip another, tick Add
// to my profile), then it writes the cover letter with it; Skip, just write;
// New brief, which carries your answers; Cancel while one is being made; the
// writing AI changed from the writer line; the whole flow by keyboard alone;
// an edit that lands on an older brief; the quote warning. The fake AI
// answers for every AI, so no request leaves this computer.

import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Brief, Settings } from '../../shared/contracts/index.ts';
import { FAKE_BRIEF } from '../fakes/fake-ai-provider.ts';
import { FAKE_COVER_LETTER } from '../fakes/smart-fake-ai.ts';
import { ORIGIN, reset, seedCloudAi, seedJob, setAiMode } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

const headers = { origin: ORIGIN };
// The ad's long line is the fake's quote, so it's word for word in the ad.
const AD = 'Senior Engineer\nExample Co\nWe want an engineer who helps our team ship faster every week.\n- TypeScript\n- Go';
const [GO, NAME_IT, TEAM] = FAKE_BRIEF.questions.map((q) => q.question) as [string, string, string];
const ANSWER = 'Yes, a small CLI in Go.';
const PROFILE_LINE = /^- \d{1,2} \w{3} \d{4}, Senior Engineer at Example Co: Have you used Go, even in a side project\? Yes, a small CLI in Go\.$/m;

const text = (page: Page) => page.getByRole('textbox', { name: 'Document text' });
const panel = (page: Page) => page.getByRole('region', { name: 'Before I write' });
const heading = (page: Page) => page.getByRole('heading', { name: 'Before I write' });
const writeButton = (page: Page) => page.getByRole('button', { name: 'Write the cover letter' });
const need = (page: Page, n: number) => page.getByRole('region', { name: 'Needs' }).getByRole('listitem').nth(n);
const question = (page: Page, q: string) => page.getByRole('region', { name: 'Questions' }).getByRole('listitem').filter({ hasText: q });
const toast = (page: Page, message: string) => page.getByRole('status').filter({ hasText: message });

async function newLetter(page: Page): Promise<number> {
  const job = await seedJob(page.request, { title: 'Senior Engineer', company: 'Example Co', jdText: AD });
  await page.goto(`/jobs/${job.id}/documents/new?kind=cover_letter`);
  await expect(heading(page)).toBeVisible();
  return job.id;
}

async function savedBrief(page: Page, jobId: number): Promise<Brief | null> {
  return ((await (await page.request.get(`/api/v1/jobs/${jobId}/brief`)).json()) as { brief: Brief | null }).brief;
}

// A brief made through the API, as another tab would.
async function makeBrief(page: Page, jobId: number): Promise<Brief> {
  const res = await page.request.post(`/api/v1/jobs/${jobId}/brief`, { headers, data: {} });
  expect(res.ok()).toBe(true);
  const done = (await res.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { kind: string; brief?: Brief })
    .find((line) => line.kind === 'done');
  return done!.brief!;
}

async function masterProfile(page: Page): Promise<string> {
  return ((await (await page.request.get('/api/v1/profile/master-profile')).json()) as { text: string }).text;
}

// Presses Tab until the cursor is on the target: the keyboard alone.
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 60; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached it.');
}

test('makes a brief, you check it, and the cover letter is written with it', async ({ page }) => {
  const jobId = await newLetter(page);
  await expect(panel(page)).toContainText("I'll make a short brief first");
  await expect(panel(page)).toContainText('Writes with Bonsai 2');

  await writeButton(page).click();
  await expect(heading(page)).toBeFocused();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Alex');
  await expect(page.getByRole('checkbox', { name: 'From a recruiter' })).toBeChecked();
  await expect(panel(page)).toContainText('We want an engineer who helps our team ship faster every week.');
  await expect(panel(page)).not.toContainText("This line isn't word for word in the ad.");
  await expect(page.getByRole('region', { name: 'Needs' }).getByRole('listitem')).toHaveCount(3);

  // Swap the first need's story, drop the third need.
  await need(page, 0).getByRole('radio', { name: 'Senior engineer at Example Co' }).check();
  await need(page, 2).getByRole('button', { name: 'Drop' }).click();
  await expect(need(page, 2).getByRole('button', { name: 'Bring back' })).toBeVisible();
  // Answer one question (for the profile too) and skip another.
  await page.getByLabel(GO).fill(ANSWER);
  await question(page, GO).getByRole('checkbox', { name: 'Add to my profile' }).check();
  await question(page, NAME_IT).getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(question(page, NAME_IT).getByRole('button', { name: 'Answer it' })).toBeFocused();

  // Straight away: the answer just typed is saved first.
  const generate = page.waitForRequest((req) => req.url().endsWith('/documents/generate'));
  await writeButton(page).click();
  const sent = (await generate).postDataJSON() as { kind: string; brief: string; briefId: number };
  await expect(toast(page, 'Added 1 answer to your master profile.')).toBeVisible();
  await expect(text(page)).toHaveValue(FAKE_COVER_LETTER);

  const brief = (await savedBrief(page, jobId))!;
  expect(sent).toEqual({ kind: 'cover_letter', brief: 'use', briefId: brief.id });
  expect(brief.needs.map((n) => [n.chosen, n.dropped])).toEqual([
    [1, false],
    [0, false],
    [0, true],
  ]);
  expect(brief.questions.map((q) => [q.answer, q.skipped, q.addToProfile])).toEqual([
    [ANSWER, false, true],
    [null, true, false],
    [null, false, false],
  ]);
  expect(brief.questions[0]!.addedAt).not.toBeNull();
  const profile = await masterProfile(page);
  expect(profile).toContain('## Answers from my applications');
  expect(profile).toMatch(PROFILE_LINE);

  // Written: the brief folds to one line.
  await expect(panel(page)).toContainText('2 needs · 1 answer · Made by Bonsai 2');
  await expect(page.getByRole('button', { name: 'Show the brief' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Needs' })).toHaveCount(0);
});

test('a double-click on the main button writes one draft', async ({ page }) => {
  const job = await seedJob(page.request, { title: 'Senior Engineer', company: 'Example Co', jdText: AD });
  await makeBrief(page, job.id);
  let drafts = 0;
  page.on('request', (req) => {
    if (req.url().endsWith('/documents/generate')) drafts++;
  });
  await page.goto(`/jobs/${job.id}/documents/new?kind=cover_letter`);
  await expect(writeButton(page)).toBeVisible();

  await writeButton(page).dblclick();
  await expect(text(page)).toHaveValue(FAKE_COVER_LETTER);
  await expect(page.getByText('A newer draft took its place.')).toHaveCount(0);
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
  expect(drafts).toBe(1);
});

test('Skip, just write writes without a brief', async ({ page }) => {
  const jobId = await newLetter(page);
  const generate = page.waitForRequest((req) => req.url().endsWith('/documents/generate'));
  await page.getByRole('button', { name: 'Skip, just write' }).click();
  expect((await generate).postDataJSON()).toMatchObject({ kind: 'cover_letter', brief: 'skip' });
  await expect(text(page)).toHaveValue(FAKE_COVER_LETTER);
  expect(await savedBrief(page, jobId)).toBeNull();
});

test('New brief makes a fresh one, and your answers carry into it', async ({ page }) => {
  const jobId = await newLetter(page);
  await writeButton(page).click();
  await expect(heading(page)).toBeFocused();
  await page.getByLabel(GO).fill(ANSWER);
  const first = await savedBrief(page, jobId);

  await page.getByRole('button', { name: 'New brief' }).click();
  await expect(heading(page)).toBeFocused();
  await expect(question(page, GO)).toContainText('Your answer from an earlier brief');
  await expect(page.getByLabel(GO)).toHaveValue(ANSWER);
  await expect(question(page, TEAM)).not.toContainText('Your answer from an earlier brief');
  const second = (await savedBrief(page, jobId))!;
  expect(second.id).not.toBe(first!.id);
  expect(second.questions[0]).toMatchObject({ question: GO, answer: ANSWER, fromEarlier: true });
});

test('Cancel while a brief is being made makes none; Skip, just write there writes instead', async ({ page }) => {
  const jobId = await newLetter(page);
  await setAiMode(page.request, 'slow');
  await writeButton(page).click();
  await expect(panel(page)).toContainText('Bonsai 2 is making the brief…');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel(page)).toContainText('Stopped. No new brief was made.');
  await expect(writeButton(page)).toBeVisible();
  expect(await savedBrief(page, jobId)).toBeNull();

  await writeButton(page).click();
  await expect(panel(page)).toContainText('Bonsai 2 is making the brief…');
  await page.getByRole('button', { name: 'Skip, just write' }).click();
  await expect(text(page)).toHaveValue(FAKE_COVER_LETTER, { timeout: 10_000 });
  await expect(panel(page)).not.toContainText('Stopped. No new brief was made.');
  expect(await savedBrief(page, jobId)).toBeNull();
});

test('the writer line changes the writing AI in one click, and by keyboard', async ({ page }) => {
  await seedCloudAi(page.request);
  await newLetter(page);
  const change = page.getByRole('button', { name: 'Change the writing AI' });
  const menu = page.getByRole('menu', { name: 'The AI that writes your documents' });
  const savedWriter = async () => ((await (await page.request.get('/api/v1/settings')).json()) as Settings).ai.writer;

  await change.click();
  await expect(menu.getByRole('menuitemradio')).toHaveCount(3);
  await expect(menu.getByRole('menuitemradio', { name: /^The AI in use \(Bonsai 2\)/ })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: /^Claude – mine/ }).click();
  await expect(toast(page, 'Claude – mine writes your documents now.')).toBeVisible();
  await expect(panel(page)).toContainText('Writes with Claude – mine');
  await expect(change).toBeFocused();
  expect(await savedWriter()).toBe('claude-mine');
  // Writing with another AI never switches the AI in use.
  await expect(page.getByRole('button', { name: /AI in use$/ })).toHaveAccessibleName(/^Bonsai 2, /);

  // By keyboard: Enter opens it on the AI that writes, Escape closes it.
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitemradio', { name: /^Claude – mine/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(change).toBeFocused();
  await expect(page).toHaveURL(/\/documents\/new/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitemradio', { name: /^The AI in use/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toast(page, 'The AI in use writes your documents now.')).toBeVisible();
  await expect(change).toBeFocused();
  expect(await savedWriter()).toBeNull();

  // The progress line names the AI that writes.
  await change.click();
  await menu.getByRole('menuitemradio', { name: /^Claude – mine/ }).click();
  await setAiMode(page.request, 'slow');
  await writeButton(page).click();
  await expect(panel(page)).toContainText('Claude – mine is making the brief…');
});

test('the whole flow by keyboard alone', async ({ page }) => {
  const jobId = await newLetter(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();

  await tabTo(page, writeButton(page));
  await page.keyboard.press('Enter');
  await expect(heading(page)).toBeFocused();

  // An arrow key swaps the first need's story; Space drops the third need.
  await tabTo(page, need(page, 0).getByRole('radio', { name: 'Moving the web app to TypeScript' }));
  await page.keyboard.press('ArrowDown');
  await expect(need(page, 0).getByRole('radio', { name: /^Senior engineer at Example Co/ })).toBeChecked();
  await tabTo(page, need(page, 2).getByRole('button', { name: 'Drop' }));
  await page.keyboard.press('Space');
  await expect(need(page, 2).getByRole('button', { name: 'Bring back' })).toBeFocused();

  // Answer one question, for the profile too; skip another.
  await tabTo(page, page.getByLabel(GO));
  await page.keyboard.type(ANSWER);
  await page.keyboard.press('Tab');
  await expect(question(page, GO).getByRole('checkbox', { name: 'Add to my profile' })).toBeFocused();
  await page.keyboard.press('Space');
  await tabTo(page, question(page, NAME_IT).getByRole('button', { name: 'Skip', exact: true }));
  await page.keyboard.press('Enter');
  await expect(question(page, NAME_IT).getByRole('button', { name: 'Answer it' })).toBeFocused();

  await tabTo(page, writeButton(page));
  await page.keyboard.press('Enter');
  await expect(toast(page, 'Added 1 answer to your master profile.')).toBeVisible();
  await expect(text(page)).toHaveValue(FAKE_COVER_LETTER);
  expect(await masterProfile(page)).toMatch(PROFILE_LINE);
  const brief = (await savedBrief(page, jobId))!;
  expect(brief.needs.map((n) => [n.chosen, n.dropped])).toEqual([
    [1, false],
    [0, false],
    [0, true],
  ]);
  expect(brief.questions.map((q) => q.skipped)).toEqual([false, true, false]);
});

test('an edit that lands on an older brief shows the newest, and says so', async ({ page }) => {
  // No live events here, so only the edit can find the newer brief.
  await page.route('**/api/v1/events', (route) => route.abort());
  const job = await seedJob(page.request, { title: 'Senior Engineer', company: 'Example Co', jdText: AD });
  const first = await makeBrief(page, job.id);
  const answered = first.questions.map((q, i) => ({ answer: i === 0 ? ANSWER : null, skipped: false, addToProfile: false }));
  expect((await page.request.patch(`/api/v1/briefs/${first.id}`, { headers, data: { questions: answered } })).ok()).toBe(true);
  await page.goto(`/jobs/${job.id}/documents/new?kind=cover_letter`);
  await expect(page.getByLabel(GO)).toHaveValue(ANSWER);
  await expect(question(page, GO)).not.toContainText('Your answer from an earlier brief');

  // Another tab makes a new brief, which carries the answer.
  await makeBrief(page, job.id);
  // A click, not uncheck(): the newer brief comes back ticked.
  await page.getByRole('checkbox', { name: 'From a recruiter' }).click();
  await expect(panel(page).getByRole('alert')).toHaveText("There's a newer brief for this job, so it's shown here now. Check it again.");
  await expect(question(page, GO)).toContainText('Your answer from an earlier brief');
  await expect(page.getByRole('checkbox', { name: 'From a recruiter' })).toBeChecked();
});

test("a quote that isn't word for word in the ad says so", async ({ page }) => {
  const job = await seedJob(page.request, { title: 'Senior Engineer', company: 'Example Co', jdText: AD });
  await makeBrief(page, job.id);
  await page.route(`**/api/v1/jobs/${job.id}/brief`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as { brief: Brief };
    await route.fulfill({ response: res, json: { brief: { ...body.brief, opening: { ...body.brief.opening, inAd: false } } } });
  });
  await page.goto(`/jobs/${job.id}/documents/new?kind=cover_letter`);
  await expect(page.getByRole('region', { name: 'Opening line' })).toContainText("This line isn't word for word in the ad. Check it.");
});

test('typing into an empty editor leaves the brief open', async ({ page }) => {
  const job = await seedJob(page.request, { title: 'Senior Engineer', company: 'Example Co', jdText: AD });
  await makeBrief(page, job.id);
  await page.goto(`/jobs/${job.id}/documents/new?kind=cover_letter`);
  await expect(page.getByRole('region', { name: 'Needs' })).toBeVisible();
  await text(page).fill('Dear Alex,');
  await expect(page.getByRole('region', { name: 'Needs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show the brief' })).toHaveCount(0);
});
