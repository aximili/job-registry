// Where the cursor goes as dialogs move from step to step, so you can keep
// typing during a call without reaching for the mouse.

import { expect, test, type Page } from '@playwright/test';
import { reset, seedCall, seedJob } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

const newJob = (page: Page) => page.getByRole('dialog', { name: 'New job' });
const logCall = (page: Page) => page.getByRole('dialog', { name: 'Log a call' });

async function openNewJobWith(page: Page, text: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /New job/ }).click();
  await newJob(page).getByLabel('Paste a job link or the ad text').fill(text);
  await newJob(page).getByRole('button', { name: 'Continue' }).click();
}

test('Continue in New job puts the cursor in Role', async ({ page }) => {
  await openNewJobWith(page, 'Data Analyst\nXero\nWe are hiring.');
  await expect(newJob(page).getByLabel('Role')).toBeFocused();
});

test('"Same job?" puts the cursor on the first Same job button', async ({ page, request }) => {
  await seedJob(request, { company: 'Atlassian', title: 'Senior Engineer' });
  await openNewJobWith(page, 'The same role, posted again.');
  await newJob(page).getByLabel('Role').fill('Senior Engineer');
  await newJob(page).getByLabel('Company').fill('Atlassian');
  await newJob(page).getByRole('button', { name: 'Save job' }).click();
  await expect(newJob(page).getByRole('button', { name: 'Same job' }).first()).toBeFocused();
});

test('picking a known person in Log call puts the cursor in Notes', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Atlassian', title: 'Engineer' });
  await seedCall(request, job.id, { name: 'Priya Shah' });
  await page.goto(`/jobs/${job.id}`);
  await expect(page.getByRole('region', { name: 'People' })).toContainText('Priya Shah');
  await page.keyboard.press('l');
  await page.keyboard.type('pri');
  await expect(logCall(page).getByRole('option', { name: 'Priya Shah' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(logCall(page).getByLabel('Notes')).toBeFocused();
});

test('picking "New person" in Log call puts the cursor in Phone', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Atlassian', title: 'Engineer' });
  await page.goto(`/jobs/${job.id}`);
  await expect(page.getByRole('region', { name: 'Call sheet' })).toContainText('Atlassian');
  await page.keyboard.press('l');
  await page.keyboard.type('Sam Lee');
  await expect(logCall(page).getByRole('option', { name: 'New person: Sam Lee' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(logCall(page).getByLabel('Phone')).toBeFocused();
});

test('a failed save in a dialog is announced as an alert', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Atlassian', title: 'Engineer' });
  await page.route('**/api/v1/interactions', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }) }),
  );
  await page.goto(`/jobs/${job.id}`);
  await expect(page.getByRole('region', { name: 'Call sheet' })).toContainText('Atlassian');
  await page.keyboard.press('l');
  await logCall(page).getByLabel('Notes').fill('Quick chat');
  await page.keyboard.press('Control+Enter');
  await expect(logCall(page).getByRole('alert')).toContainText('Something went wrong.');
});
