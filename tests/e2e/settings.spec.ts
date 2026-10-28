import { expect, test } from '@playwright/test';
import { reset, seedJob } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test('renames a status and the list shows the new label', async ({ page, request }) => {
  await page.goto('/settings');
  await page.getByLabel('Label for interview_1').fill('First interview');
  await page.getByRole('button', { name: 'Save statuses' }).click();
  await expect(page.getByRole('status')).toContainText('Statuses saved.');
  await seedJob(request, { company: 'Xero', title: 'Analyst', status: 'interview_1' });
  await page.goto('/');
  await expect(page.getByRole('table', { name: 'Jobs' })).toContainText('First interview');
});

test('adds a status and it appears in the status picker', async ({ page, request }) => {
  await page.goto('/settings');
  await page.getByLabel('New status').fill('Phone screen');
  await page.getByRole('button', { name: 'Add status' }).click();
  await page.getByRole('button', { name: 'Save statuses' }).click();
  await expect(page.getByRole('status')).toContainText('Statuses saved.');
  const job = await seedJob(request, { company: 'Canva', title: 'Designer' });
  await page.goto(`/jobs/${job.id}`);
  await expect(page.getByRole('combobox', { name: 'Status' }).locator('option', { hasText: 'Phone screen' })).toHaveCount(1);
});

test('Back up now shows the backup file name', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText(/Backed up to .*jobs-\d{4}-\d{2}-\d{2}-\d{6}\.db/)).toBeVisible();
});

test('Rebuild search index reports what it indexed', async ({ page, request }) => {
  await seedJob(request, { company: 'Xero', title: 'Analyst' });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Rebuild search index' }).click();
  await expect(page.getByText('Search index rebuilt: 1 jobs, 0 contacts.')).toBeVisible();
});
