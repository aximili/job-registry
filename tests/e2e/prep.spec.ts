// The job page's "Get ready": a plan for the interview in five parts, New
// plan with the earlier ones kept by date, Cancel, a newer plan taking the
// place of one being made, and all of it by keyboard alone. The fake AI
// gives the same made-up plan each time.

import { expect, test, type Page } from '@playwright/test';
import { ORIGIN, reset, seedJob, setAiMode } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

// Each part's heading starts with its number.
const PARTS = ['1 Learn in a day', '2 A practice project', '3 Likely interview questions', '4 Questions to ask them', '5 Refresh before the interview'];

const panel = (page: Page) => page.getByRole('region', { name: 'Get ready' });
const heading = (page: Page) => panel(page).getByRole('heading', { name: 'Get ready', level: 2 });

async function interviewJob(page: Page): Promise<number> {
  const job = await seedJob(page.request, { title: 'Senior Engineer', company: 'Example Co', status: 'interview_1' });
  return job.id;
}

// A plan made straight through the API, as another tab would.
async function makePlan(page: Page, jobId: number) {
  const res = await page.request.post(`/api/v1/jobs/${jobId}/prep`, { headers: { origin: ORIGIN }, data: {} });
  expect(res.ok()).toBe(true);
  expect((await res.text()).trim().split('\n').at(-1)).toContain('"kind":"done"');
}

async function plansSaved(page: Page, jobId: number): Promise<number> {
  return ((await (await page.request.get(`/api/v1/jobs/${jobId}/prep`)).json()) as { plans: unknown[] }).plans.length;
}

test('Get ready makes a plan, shows its five parts and moves the focus to it', async ({ page }) => {
  const id = await interviewJob(page);
  await page.goto(`/jobs/${id}`);
  await expect(panel(page).getByText('Writes with Bonsai 2')).toBeVisible();

  await panel(page).getByRole('button', { name: 'Get ready' }).click();
  await expect(heading(page)).toBeFocused();
  await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText(PARTS);
  await expect(panel(page).getByText(/^Made by Bonsai 2, /)).toBeVisible();
  // One thing from each part.
  await expect(panel(page).getByRole('heading', { name: /^Go basics/ })).toContainText('4 hours');
  await expect(panel(page).getByText('Rewrite a small TypeScript script of yours in Go.')).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: /^A build-time dashboard/ })).toContainText('6 hours');
  await expect(panel(page).getByText('Tell us about a time you made developers faster.')).toBeVisible();
  await expect(panel(page).getByText('What does a typical week look like for this team?')).toBeVisible();
  await expect(panel(page).getByText('How you measured the 30% cut in build times')).toBeVisible();
  // The call sheet and the button that made it are still where they were.
  await expect(page.getByRole('region', { name: 'Call sheet' })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Get ready' })).toHaveCount(0);

  await page.reload();
  await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText(PARTS);
  await expect(panel(page).getByRole('button', { name: 'New plan' })).toBeVisible();
});

test('New plan keeps the old one under Earlier plans, and any one opens', async ({ page }) => {
  const id = await interviewJob(page);
  await makePlan(page, id);
  await page.goto(`/jobs/${id}`);
  await expect(panel(page).getByRole('heading', { name: 'Learn in a day' })).toBeVisible();
  await expect(panel(page).getByRole('navigation', { name: 'Earlier plans' })).toHaveCount(0);

  await panel(page).getByRole('button', { name: 'New plan' }).click();
  const earlier = panel(page).getByRole('navigation', { name: 'Earlier plans' }).getByRole('button');
  await expect(earlier).toHaveCount(1);
  await expect(earlier).toHaveText(/^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2} [ap]m$/);
  await expect(heading(page)).toBeFocused();
  expect(await plansSaved(page, id)).toBe(2);

  await earlier.click();
  await expect(panel(page).getByText('This is an earlier plan.')).toBeVisible();
  await expect(earlier).toHaveAttribute('aria-current', 'true');
  await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText(['Earlier plans', ...PARTS]);

  await panel(page).getByRole('button', { name: 'Show the newest' }).click();
  await expect(panel(page).getByText('This is an earlier plan.')).toHaveCount(0);
  await expect(earlier).not.toHaveAttribute('aria-current', 'true');
});

test('Cancel stops the plan part-way, and nothing is saved', async ({ page }) => {
  const id = await interviewJob(page);
  await setAiMode(page.request, 'slow');
  await page.goto(`/jobs/${id}`);
  const start = panel(page).getByRole('button', { name: 'Get ready' });
  await start.click();
  await expect(panel(page).getByText('Bonsai 2 is making your plan…')).toBeVisible();
  await expect(panel(page).getByRole('timer')).toHaveText(/^0:0\d$/);

  await panel(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(panel(page).getByText(/is making your plan/)).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(start).toBeFocused();
  // Long enough for the slow AI to have answered, had it not been stopped.
  await page.waitForTimeout(2_000);
  expect(await plansSaved(page, id)).toBe(0);
  await expect(panel(page).getByRole('heading', { name: 'Learn in a day' })).toHaveCount(0);
});

test('a newer plan for the job takes the place of one being made, and the page says so', async ({ page }) => {
  const id = await interviewJob(page);
  await setAiMode(page.request, 'slow');
  await page.goto(`/jobs/${id}`);
  await panel(page).getByRole('button', { name: 'Get ready' }).click();
  await expect(panel(page).getByText('Bonsai 2 is making your plan…')).toBeVisible();

  // Another tab asks for a plan for the same job.
  await makePlan(page, id);
  await expect(panel(page).getByRole('alert')).toHaveText('A newer plan for this job took its place.');
  // That plan shows here too, without a reload.
  await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText(PARTS);
  expect(await plansSaved(page, id)).toBe(1);
});

test('by keyboard alone: Get ready, New plan, then open the earlier plan', async ({ page }) => {
  const id = await interviewJob(page);
  await page.goto(`/jobs/${id}`);
  // The last control in Documents, then on into Get ready.
  await page.getByRole('button', { name: 'Attach file' }).focus();
  await page.keyboard.press('Tab');
  await expect(panel(page).getByRole('button', { name: 'Get ready' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(heading(page)).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(panel(page).getByRole('button', { name: 'New plan' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel(page).getByRole('navigation', { name: 'Earlier plans' })).toBeVisible();
  await expect(heading(page)).toBeFocused();

  // New plan, the writer's Change, then the earlier plan's date.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(panel(page).getByRole('button', { name: 'Change the writing AI' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel(page).getByRole('navigation', { name: 'Earlier plans' }).getByRole('button')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel(page).getByText('This is an earlier plan.')).toBeVisible();
  await expect(heading(page)).toBeFocused();
});

test('while a plan is being made, Esc stays on the job and leaving asks first', async ({ page }) => {
  const id = await interviewJob(page);
  await setAiMode(page.request, 'slow');
  await page.goto(`/jobs/${id}`);
  await panel(page).getByRole('button', { name: 'Get ready' }).click();
  await expect(panel(page).getByText('Bonsai 2 is making your plan…')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/jobs/${id}$`));
  await expect(panel(page).getByRole('button', { name: 'Cancel' })).toBeVisible();

  const asked = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const dialog = await asked;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.accept();
});
