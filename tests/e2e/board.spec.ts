import { expect, test, type Page } from '@playwright/test';
import { localDate } from '../../shared/dates.ts';
import { ORIGIN, reset, seedJob } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

const column = (page: Page, label: string) => page.getByRole('region', { name: new RegExp(`^${label}, `) });
const card = (page: Page, name: string) => page.getByRole('article', { name });

test('shows a column per open status with its jobs', async ({ page, request }) => {
  await seedJob(request, { title: 'Analyst', company: 'Xero' });
  await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await page.goto('/board');
  await expect(page.getByRole('heading', { name: 'Board', level: 1 })).toBeVisible();
  await expect(column(page, 'Saved')).toContainText('Analyst');
  await expect(column(page, 'Applied')).toContainText('Senior Engineer');
  await expect(column(page, 'Applied')).toHaveAccessibleName('Applied, 1 job');
  await expect(column(page, 'Screening')).toContainText('No jobs');
  await expect(page.getByRole('region', { name: /^Rejected, / })).toHaveCount(0);
  await expect(card(page, 'Senior Engineer at Atlassian')).toContainText(/Applied \d+ \w+/);
});

test('drags a job to another column, and its status changes', async ({ page, request }) => {
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await page.goto('/board');
  await card(page, 'Senior Engineer at Atlassian').dragTo(column(page, 'Interview 1'));
  await expect(column(page, 'Interview 1')).toContainText('Senior Engineer');
  await expect(column(page, 'Applied')).not.toContainText('Senior Engineer');
  await expect(page.getByText('Moved Senior Engineer to Interview 1.')).toBeVisible();
  expect(((await (await request.get(`/api/v1/jobs/${job.id}`)).json()) as { status: string }).status).toBe('interview_1');
});

test('moves a job with the keyboard, and only when you press Move', async ({ page, request }) => {
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await page.goto('/board');
  const moves: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/status')) moves.push(r.url());
  });
  const menu = page.getByLabel('Move Senior Engineer at Atlassian to');
  await expect(menu.locator('option', { hasText: 'Applied' })).toHaveCount(0);
  // Choosing in the menu (a typed letter, an arrow key on Windows) never moves the card by itself.
  await menu.focus();
  await page.keyboard.press('s');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  expect(moves).toEqual([]);
  await expect(column(page, 'Applied')).toContainText('Senior Engineer');

  await menu.selectOption({ label: 'Screening' });
  await page.getByRole('button', { name: 'Move Senior Engineer at Atlassian', exact: true }).click();
  await expect(page.getByText('Moved Senior Engineer to Screening.')).toBeVisible();
  await expect(column(page, 'Screening')).toContainText('Senior Engineer');
  await expect(page.getByLabel('Move Senior Engineer at Atlassian to')).toBeFocused();
  expect(moves).toHaveLength(1);
  const history = (await (await request.get(`/api/v1/jobs/${job.id}/callsheet`)).json()) as { history: { toStatus: string; source: string }[] };
  expect(history.history[0]).toMatchObject({ toStatus: 'screening', source: 'manual' });
});

test('Move is off until you choose a status', async ({ page, request }) => {
  await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await page.goto('/board');
  await expect(page.getByRole('button', { name: 'Move Senior Engineer at Atlassian', exact: true })).toBeDisabled();
});

test('text dropped on a column moves nothing', async ({ page, request }) => {
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await page.goto('/board');
  await expect(column(page, 'Applied')).toContainText('Senior Engineer');
  await column(page, 'Screening').evaluate((el, id) => {
    const data = new DataTransfer();
    data.setData('text/plain', String(id));
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  }, job.id);
  await page.waitForTimeout(300);
  await expect(column(page, 'Applied')).toContainText('Senior Engineer');
  expect(((await (await request.get(`/api/v1/jobs/${job.id}`)).json()) as { status: string }).status).toBe('applied');
});

test('a move to a hidden closed column puts the focus, visibly, on the heading', async ({ page, request }) => {
  await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await page.goto('/board');
  await page.getByLabel('Move Senior Engineer at Atlassian to').selectOption({ label: 'Rejected' });
  await page.getByRole('button', { name: 'Move Senior Engineer at Atlassian', exact: true }).click();
  const heading = page.getByRole('heading', { name: 'Board', level: 1 });
  await expect(heading).toBeFocused();
  expect(await heading.evaluate((h) => getComputedStyle(h).outlineStyle)).not.toBe('none');
});

test('Show closed statuses adds the closed columns, and is remembered', async ({ page, request }) => {
  await seedJob(request, { title: 'Designer', company: 'Canva', status: 'rejected' });
  await page.goto('/board');
  await expect(page.getByText('Designer')).toHaveCount(0);
  await page.getByLabel('Show closed statuses').check();
  await expect(column(page, 'Rejected')).toContainText('Designer');
  await page.reload();
  await expect(page.getByLabel('Show closed statuses')).toBeChecked();
  await expect(column(page, 'Rejected')).toContainText('Designer');
});

test('a refused move puts the card back', async ({ page, request }) => {
  await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await page.goto('/board');
  await page.route('**/api/v1/jobs/*/status', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'validation', message: "Unknown status 'screening'." } }),
    }),
  );
  await page.getByLabel('Move Senior Engineer at Atlassian to').selectOption({ label: 'Screening' });
  await page.getByRole('button', { name: 'Move Senior Engineer at Atlassian', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText("Unknown status 'screening'.");
  await expect(column(page, 'Applied')).toContainText('Senior Engineer');
  await expect(column(page, 'Screening')).not.toContainText('Senior Engineer');
  // The focus comes back to the card, in the column it went back to.
  await expect(page.getByLabel('Move Senior Engineer at Atlassian to')).toBeFocused();
});

test('a follow-up shows on the card', async ({ page, request }) => {
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  const d = new Date();
  d.setDate(d.getDate() - 2);
  await request.put(`/api/v1/jobs/${job.id}/follow-up`, { headers: { origin: ORIGIN }, data: { on: localDate(d) } });
  await page.goto('/board');
  await expect(card(page, 'Senior Engineer at Atlassian')).toContainText('Follow up: 2 days late');
});

test('the header links to the board', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Board' }).click();
  await expect(page).toHaveURL(/\/board$/);
});
