// The extension on (copies of) the job sites, with the real app behind it on
// 4799 and the fake AI. Phase 3's goal: clicking through 5 Seek results shows
// a rating on each, and saving takes one click.

import type { Page } from '@playwright/test';
import { shortDate } from '../../shared/dates.ts';
import { ORIGIN, reset, setAiMode } from '../e2e/helpers.ts';
import { expect, SITES, test } from './fixtures.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

const panel = (page: Page) => page.getByRole('complementary', { name: 'Job Registry' });

test('clicking quickly through five Seek results shows a rating for each, and only the last one runs', async ({ page, request }) => {
  await setAiMode(request, 'slow'); // each rating takes 1.5 s
  await page.goto(`${SITES}/seek/jobs`);
  const cards = page.getByRole('link', { name: / at / });
  await expect(cards).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    await cards.nth(i).click();
    await expect(panel(page)).toContainText(['Backend', 'Frontend', 'Data', 'Platform', 'Mobile'][i]! + ' Engineer');
    await page.waitForTimeout(200);
  }
  await expect(panel(page)).toContainText('Mobile Engineer · Airwallex');
  await expect(panel(page)).toContainText('Good match · 72', { timeout: 10_000 });
  const calls = (await (await request.get('/__test/ai-calls')).json()) as { ratings: number; ratingsFinished: number };
  // Each click cancelled the rating before it, in the browser and on the
  // server, so only the last one ran to the end.
  expect(calls.ratings).toBeGreaterThan(1);
  expect(calls.ratingsFinished).toBe(1);

  // Going back to an earlier job rates that one, from scratch or the cache.
  await setAiMode(request, 'smart');
  await cards.nth(1).click();
  await expect(panel(page)).toContainText('Frontend Engineer · Canva');
  await expect(panel(page)).toContainText('Good match · 72');
});

test('saving a job takes one click, and the panel then says it is saved', async ({ page, request }) => {
  await page.goto(`${SITES}/seek/job/81234567`);
  await expect(panel(page)).toContainText('Senior Software Engineer · Atlassian');
  await panel(page).getByLabel('Status').selectOption('applied');
  await panel(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel(page)).toContainText(`Saved · Applied ${shortDate(new Date().toISOString())}`);

  const jobs = (await (await request.get('/api/v1/jobs?status=all')).json()) as { id: number; title: string }[];
  expect(jobs.map((j) => j.title)).toEqual(['Senior Software Engineer']);
  const sheet = (await (await request.get(`/api/v1/jobs/${jobs[0]!.id}/callsheet`)).json()) as { history: { source: string }[]; postings: { jdText: string }[] };
  expect(sheet.history[0]!.source).toBe('extension');
  expect(sheet.postings[0]!.jdText).toContain('$150,000 – $170,000 per year + super');

  // Opening it again shows it's saved.
  await page.reload();
  await expect(panel(page)).toContainText(`Saved · Applied ${shortDate(new Date().toISOString())}`);
  await expect(panel(page).getByRole('button', { name: 'Open in Job Registry' })).toBeVisible();
});

test('a job saved from Seek is recognised as "Same job?" on LinkedIn', async ({ page, request }) => {
  const res = await request.post('/api/v1/jobs', {
    headers: { origin: ORIGIN },
    data: {
      capture: { sourceUrl: null, canonicalUrl: null, sourceSite: 'pasted', externalId: null, jdText: 'An ad.', capturedAt: new Date().toISOString() },
      fields: { title: 'Product Designer', company: 'Canva' },
      decision: 'new',
    },
  });
  expect(res.ok()).toBe(true);
  await page.goto(`${SITES}/linkedin/jobs/view/4012345678/`);
  await expect(panel(page)).toContainText('Looks like Product Designer at Canva');
  await panel(page).getByRole('button', { name: 'Same job' }).click();
  await expect(panel(page).getByRole('status')).toHaveText('Saved');
  await expect(panel(page).getByRole('button', { name: 'Open in Job Registry' })).toBeVisible();
});

test("with the app not running, the panel says so and offers Try again", async ({ page, background }) => {
  await background.evaluate(() => chrome.storage.local.set({ serverUrl: 'http://127.0.0.1:1' }));
  await page.goto(`${SITES}/indeed/viewjob?jk=a1b2c3d4e5f60718`);
  await expect(panel(page)).toContainText("Job Registry isn't running. Start it, then press Try again.");
  await background.evaluate(() => chrome.storage.local.remove('serverUrl'));
  await panel(page).getByRole('button', { name: 'Try again' }).click();
  await expect(panel(page)).toContainText('Business Analyst · Harbour Talent');
  await expect(panel(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();
});

test('the panel can be tucked away, and stays that way', async ({ page }) => {
  await page.goto(`${SITES}/seek/job/81234567`);
  await panel(page).getByRole('button', { name: 'Hide' }).click();
  await expect(panel(page).getByRole('button', { name: 'Show' })).toBeVisible();
  await expect(panel(page)).not.toContainText('Senior Software Engineer');
  await page.reload();
  await expect(panel(page).getByRole('button', { name: 'Show' })).toBeVisible();
});

test('the popup saves a job ad from any other website', async ({ context, page, background, request }) => {
  await page.goto(`${SITES}/other/article`);
  await page.bringToFront();
  const popupOpened = context.waitForEvent('page');
  await background.evaluate(() => chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup' }));
  const popup = await popupOpened;
  await expect(popup.getByRole('status').first()).toHaveText('Connected to Job Registry.');
  await popup.getByRole('button', { name: 'Save this page' }).click();
  await expect(popup.getByText('Senior Data Analyst')).toBeVisible();
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Open in Job Registry' })).toBeVisible();
  const jobs = (await (await request.get('/api/v1/jobs?status=all')).json()) as { title: string }[];
  expect(jobs.map((j) => j.title)).toEqual(['Senior Data Analyst']);
});

const seedJob = (request: import('@playwright/test').APIRequestContext, title: string, company: string) =>
  request.post('/api/v1/jobs', {
    headers: { origin: ORIGIN },
    data: {
      capture: { sourceUrl: null, canonicalUrl: null, sourceSite: 'pasted', externalId: null, jdText: 'An ad.', capturedAt: new Date().toISOString() },
      fields: { title, company },
      decision: 'new',
    },
  });

test("one job's status and note never carry over to the next job's \"Same job?\" choice", async ({ page, request }) => {
  expect((await seedJob(request, 'Frontend Engineer', 'Canva')).ok()).toBe(true);
  await page.goto(`${SITES}/seek/jobs`);
  const cards = page.getByRole('link', { name: / at / });
  await cards.nth(0).click();
  await expect(panel(page)).toContainText('Backend Engineer · Atlassian');
  await panel(page).getByLabel('Status').selectOption('applied');
  await panel(page).getByLabel('Note').fill('NOTE MEANT FOR THE ATLASSIAN JOB');
  await panel(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel(page)).toContainText('Saved · Applied');

  await cards.nth(1).click();
  await expect(panel(page)).toContainText('Looks like Frontend Engineer at Canva');
  // The choice comes with its own status and note, fresh for this job.
  await expect(panel(page).getByLabel('Status')).toHaveValue('saved');
  await expect(panel(page).getByLabel('Note')).toHaveValue('');
  await panel(page).getByRole('button', { name: 'Different job' }).click();
  await expect(panel(page).getByRole('button', { name: 'Open in Job Registry' })).toBeVisible();

  // The one seeded and the new one: both Saved, neither with the other job's note.
  const jobs = (await (await request.get('/api/v1/jobs?status=all')).json()) as { id: number; title: string; status: string }[];
  const frontend = jobs.filter((j) => j.title === 'Frontend Engineer');
  expect(frontend.map((j) => j.status)).toEqual(['saved', 'saved']);
  for (const job of frontend) {
    const notes = (await (await request.get(`/api/v1/jobs/${job.id}/notes`)).json()) as unknown[];
    expect(notes).toEqual([]);
  }
});

test('"Save selection" with nothing selected says so and keeps both choices; with a selection it saves', async ({ page, request }) => {
  await page.goto(`${SITES}/seek/job/99999999`);
  await expect(panel(page)).toContainText("Couldn't read this job", { timeout: 10_000 });
  await panel(page).getByRole('button', { name: 'Save selection' }).click();
  await expect(panel(page)).toContainText('Select the ad text first, then press Save selection.');
  await expect(panel(page).getByRole('button', { name: 'Save page' })).toBeVisible();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('loose-text')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await panel(page).getByRole('button', { name: 'Save selection' }).click();
  await panel(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Open in Job Registry' })).toBeVisible();
  const jobs = (await (await request.get('/api/v1/jobs?status=all')).json()) as { id: number }[];
  const sheet = (await (await request.get(`/api/v1/jobs/${jobs[0]!.id}/callsheet`)).json()) as { postings: { jdText: string; canonicalUrl: string }[] };
  expect(sheet.postings[0]!.jdText).toContain('Strong SQL is a must');
  expect(sheet.postings[0]!.canonicalUrl).toBe('https://www.seek.com.au/job/99999999');
});

test('more of the ad arriving a moment later keeps the status and note you chose', async ({ page }) => {
  await page.goto(`${SITES}/seek/job/88888888`);
  await expect(panel(page)).toContainText('Growing Role · Grow Co');
  await panel(page).getByLabel('Status').selectOption('applied');
  await panel(page).getByLabel('Note').fill('Keep me');
  await page.waitForTimeout(2500);
  await expect(panel(page).getByLabel('Status')).toHaveValue('applied');
  await expect(panel(page).getByLabel('Note')).toHaveValue('Keep me');
});

test('Esc tucks the panel away and leaves the cursor on Show', async ({ page }) => {
  await page.goto(`${SITES}/seek/job/81234567`);
  await panel(page).getByRole('button', { name: 'Save', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(panel(page).getByRole('button', { name: 'Show' })).toBeFocused();
});

test('the popup offers Try again when the app is not running', async ({ context, page, background }) => {
  await background.evaluate(() => chrome.storage.local.set({ serverUrl: 'http://127.0.0.1:1' }));
  await page.goto(`${SITES}/other/article`);
  const popupOpened = context.waitForEvent('page');
  await background.evaluate(() => chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup' }));
  const popup = await popupOpened;
  await expect(popup.getByText("Job Registry isn't running.")).toBeVisible();
  await background.evaluate(() => chrome.storage.local.remove('serverUrl'));
  await popup.getByRole('button', { name: 'Try again' }).click();
  await expect(popup.getByRole('status').first()).toHaveText('Connected to Job Registry.');
});

