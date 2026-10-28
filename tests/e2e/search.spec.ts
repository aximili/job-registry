import { expect, test } from '@playwright/test';
import { reset, seedCall, seedJob } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

const searchBox = (page: import('@playwright/test').Page) => page.getByRole('combobox', { name: 'Search jobs' });
const results = (page: import('@playwright/test').Page) => page.getByRole('listbox', { name: 'Search results' });
const jobsTable = (page: import('@playwright/test').Page) => page.getByRole('table', { name: 'Jobs' });

test('search is focused on load and finds a job by three letters of the company in under 2 seconds', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Atlassian', title: 'Senior Engineer' });
  await seedJob(request, { company: 'Canva', title: 'Designer' });
  await page.goto('/');
  await expect(searchBox(page)).toBeFocused();
  await page.keyboard.type('atl');
  await expect(results(page).getByRole('option').first()).toContainText('Atlassian', { timeout: 2000 });
  await expect(results(page).getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}$`));
});

test('finds a job by part of a contact phone number', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Atlassian', title: 'Senior Engineer' });
  await seedCall(request, job.id, { name: 'Sam Lee', phone: '+61 412 345 678' });
  await page.goto('/');
  await page.keyboard.type('345 678');
  await expect(results(page).getByRole('option').first()).toContainText('Atlassian', { timeout: 2000 });
});

test('/ and Ctrl+K focus the search box; Esc clears it and shows the list', async ({ page, request }) => {
  await seedJob(request, { company: 'Xero', title: 'Analyst' });
  await page.goto('/');
  await expect(jobsTable(page)).toContainText('Xero');

  await searchBox(page).blur();
  await page.keyboard.press('/');
  await expect(searchBox(page)).toBeFocused();
  await page.keyboard.type('xe');
  await expect(results(page)).toContainText('Xero');
  await page.keyboard.press('Escape');
  await expect(searchBox(page)).toHaveValue('');
  await expect(jobsTable(page)).toContainText('Xero');

  await searchBox(page).blur();
  await page.keyboard.press('Control+k');
  await expect(searchBox(page)).toBeFocused();
});

test('status chips filter the list', async ({ page, request }) => {
  await seedJob(request, { company: 'Applied Co', title: 'Role A', status: 'applied' });
  await seedJob(request, { company: 'Rejected Co', title: 'Role B', status: 'rejected' });
  await page.goto('/');
  await expect(jobsTable(page)).toContainText('Applied Co');
  await expect(jobsTable(page)).not.toContainText('Rejected Co');

  await page.getByRole('button', { name: 'Closed', exact: true }).click();
  await expect(jobsTable(page)).toContainText('Rejected Co');
  await expect(jobsTable(page)).not.toContainText('Applied Co');

  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(jobsTable(page)).toContainText('Applied Co');
  await expect(jobsTable(page)).toContainText('Rejected Co');
});

test('a job with no title or company shows placeholders', async ({ page, request }) => {
  await seedJob(request, {});
  await page.goto('/');
  await expect(jobsTable(page)).toContainText('Untitled role');
  await expect(jobsTable(page)).toContainText('Unknown company');
});
