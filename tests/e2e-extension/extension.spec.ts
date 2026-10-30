// The extension on (copies of) the job sites, with the real app behind it on
// 4799 and the fake AI. Phase 3's goal: clicking through 5 Seek results shows
// a rating on each, and saving takes one click.

import type { APIRequestContext, Page } from '@playwright/test';
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

test("a job opened from Seek's home page shows in the panel, which still takes typing and scrolls while Seek's pop-over is open", async ({ page, background }) => {
  // A short panel, so its body has something to scroll.
  await background.evaluate(() => chrome.storage.local.set({ panelPlace: { right: 16, bottom: 16, width: null, height: 150 } }));
  await page.goto(`${SITES}/seek/`);
  await page.getByRole('link', { name: 'Software Engineer', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Open job details' })).toBeVisible();
  await expect(panel(page)).toContainText('Software Engineer · Ucroo Pty Ltd');
  await expect(panel(page)).toContainText('Good match · 72');

  // Seek's pop-over pulls focus back into itself, but not from the panel.
  const note = panel(page).getByLabel('Note');
  await note.click();
  await page.keyboard.type('Ask about the stack');
  await expect(note).toHaveValue('Ask about the stack');

  // And it stops the mouse wheel outside it, but not over the panel.
  const body = panel(page).locator('.body');
  const b = (await body.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  // Closing the pop-over leaves the job, as on a search page.
  await page.getByRole('dialog', { name: 'Open job details' }).getByRole('button', { name: 'Close' }).click();
  await expect(panel(page)).toHaveCount(0);
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

test('the panel moves by its bar and resizes from a corner, stays that way, and a double-click puts it back', async ({ page }) => {
  await page.goto(`${SITES}/seek/job/81234567`);
  await expect(panel(page)).toContainText('Good match · 72');
  const box = async () => {
    const b = (await panel(page).boundingBox())!;
    return { left: Math.round(b.x), top: Math.round(b.y), right: Math.round(b.x + b.width), bottom: Math.round(b.y + b.height), width: Math.round(b.width), height: Math.round(b.height) };
  };
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 5 });
    await page.mouse.up();
  };
  const start = await box();

  // By the bar, "Job Registry": the whole panel moves.
  await drag(start.left + 40, start.top + 16, -300, -200);
  const moved = await box();
  expect(moved).toMatchObject({ right: start.right - 300, bottom: start.bottom - 200, width: start.width, height: start.height });

  // By its top-left corner: it grows up and left.
  await drag(moved.left + 1, moved.top + 1, -100, -60);
  const resized = await box();
  expect(resized).toMatchObject({ right: moved.right, bottom: moved.bottom, width: moved.width + 100, height: moved.height + 60 });

  await page.reload();
  await expect(panel(page)).toContainText('Good match · 72');
  expect(await box()).toEqual(resized);

  await page.mouse.dblclick(resized.left + 40, resized.top + 16);
  const back = await box();
  expect(back).toMatchObject({ right: start.right, bottom: start.bottom, width: start.width });
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

// Quick marks on a search list (Phase 7). The list is a copy of three real
// Seek cards; job 81234567 is also the job at /seek/job/81234567.
const LIST_IDS = ['81234567', '81234570', '81234571'];

// Each card's marks, by job id: the words inside each mark's shadow root
// (open in the test build). A card with two marks would show two here.
const marksByCard = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll('article[data-job-id]'), (card) => [
        card.getAttribute('data-job-id'),
        Array.from(card.querySelectorAll('[data-job-registry-mark]'), (host) => host.shadowRoot?.querySelector('.mark')?.textContent ?? '(no open shadow root)'),
      ]),
    ),
  );

const cardCalls = async (request: APIRequestContext) =>
  ((await (await request.get('/__test/ai-calls')).json()) as { cards: number }).cards;

test('each card on a search list gets a quick mark', async ({ page }) => {
  await page.goto(`${SITES}/seek/list`);
  await expect
    .poll(() => marksByCard(page), { timeout: 15_000 })
    .toEqual(Object.fromEntries(LIST_IDS.map((id) => [id, ['Good 68 · quick']])));
  // The tooltip gives the AI's reason and says what "quick" means.
  const tooltip = await page.evaluate(
    () => document.querySelector('[data-job-registry-mark]')?.shadowRoot?.querySelector('.mark')?.getAttribute('title') ?? null,
  );
  expect(tooltip).toBe('Your TypeScript work fits the role.\nQuick rating from the card. Open the job for a full rating.');
});

test('a card for a job you saved says so', async ({ page, request }) => {
  await page.goto(`${SITES}/seek/job/81234567`);
  await expect(panel(page)).toContainText('Senior Software Engineer · Atlassian');
  await panel(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Open in Job Registry' })).toBeVisible();

  await page.goto(`${SITES}/seek/list`);
  await expect
    .poll(() => marksByCard(page), { timeout: 15_000 })
    .toEqual({ '81234567': ['Saved'], '81234570': ['Good 68 · quick'], '81234571': ['Good 68 · quick'] });
  // The saved job's card never went to the AI.
  expect(await cardCalls(request)).toBe(2);
});

test("with 'Rate the jobs in search results' off, no marks", async ({ page, request, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const option = page.getByLabel('Rate the jobs in search results (a quick rating from each card)');
  // Each checkbox is tied to its hint, so a screen reader reads it out.
  await expect(page.getByLabel('Rate jobs automatically on job pages')).toHaveAccessibleDescription(
    "Ratings use your master profile in Job Registry. Turn this off, and a job page isn't rated until you save the job.",
  );
  await expect(option).toHaveAccessibleDescription('Each card gets a quick rating from what the card shows. Only the tab in front is rated.');
  await expect(option).toBeChecked();
  await option.uncheck();
  await expect(page.getByRole('status')).toHaveText('Saved.');

  // The list with a job open in its split view, as clicking a card does
  // (Seek adds the job id and `type`). The panel showing up proves the
  // extension is running on this page. This copy of the list has no job
  // details, so the panel says it couldn't read the job, and nothing is rated.
  await page.goto(`${SITES}/seek/list?jobId=81234567&type=standard`);
  await expect(page.locator('article[data-job-id]')).toHaveCount(3);
  await expect(panel(page)).toContainText("Couldn't read this job", { timeout: 10_000 });
  await page.waitForTimeout(3000);
  expect(await marksByCard(page)).toEqual(Object.fromEntries(LIST_IDS.map((id) => [id, []])));
  expect(await cardCalls(request)).toBe(0);
});
