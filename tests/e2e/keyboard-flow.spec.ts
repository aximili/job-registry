// The recruiter-call flow done the way people really do it: fast, with the
// keyboard, and with reflexes like Esc and Ctrl+K.
import { expect, test, type Page } from '@playwright/test';
import { reset, seedCall, seedJob } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

const results = (page: Page) => page.getByRole('listbox', { name: 'Search results' });
const searchBox = (page: Page) => page.getByRole('combobox', { name: 'Search jobs' });
const callSheet = (page: Page) => page.getByRole('region', { name: 'Call sheet' });
const timeline = (page: Page) => page.getByRole('region', { name: 'Timeline' });
const statusPicker = (page: Page) => page.getByRole('combobox', { name: 'Status' });
const logCall = (page: Page) => page.getByRole('dialog', { name: 'Log a call' });
const newJob = (page: Page) => page.getByRole('dialog', { name: 'New job' });

async function copyToClipboard(page: Page, text: string) {
  await page.evaluate(() => {
    const scratch = document.createElement('textarea');
    scratch.id = 'scratch';
    document.body.append(scratch);
  });
  await page.fill('#scratch', text);
  await page.focus('#scratch');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+C');
  await page.evaluate(() => document.getElementById('scratch')?.remove());
}

test('Enter right after typing opens the job for the new search, not the last one', async ({ page, request }) => {
  const telstra = await seedJob(request, { company: 'Telstra', title: 'Architect' });
  const atlassian = await seedJob(request, { company: 'Atlassian', title: 'Engineer' });
  await page.goto('/');
  await page.keyboard.type('tel');
  await expect(results(page).getByRole('option').first()).toContainText('Telstra');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/jobs/${telstra.id}$`));
  await page.keyboard.press('/');
  await page.keyboard.type('atl', { delay: 40 });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/jobs/${atlassian.id}$`));
});

test('changing status with the keyboard records one change and gives the keys back', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Canva', title: 'Designer', status: 'applied' });
  await page.goto(`/jobs/${job.id}`);
  await expect(callSheet(page)).toContainText('Canva');
  await page.keyboard.press('s');
  await statusPicker(page).selectOption('screening');
  await statusPicker(page).selectOption('interview_1');
  await expect(timeline(page)).toContainText('Applied → Interview 1');
  await expect(timeline(page)).not.toContainText('Screening');
  await expect(statusPicker(page)).not.toBeFocused();
  await page.keyboard.press('l');
  await expect(logCall(page)).toBeVisible();
});

test('Esc on the status picker puts the old status back', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Canva', title: 'Designer', status: 'applied' });
  await page.goto(`/jobs/${job.id}`);
  await expect(callSheet(page)).toContainText('Canva');
  await page.keyboard.press('s');
  await statusPicker(page).selectOption('offer');
  await page.keyboard.press('Escape');
  await expect(statusPicker(page)).toHaveValue('applied');
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(statusPicker(page)).toHaveValue('applied');
});

test('typing the name of someone already on the job logs the call against them', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Atlassian', title: 'Engineer' });
  await seedCall(request, job.id, { name: 'Priya Shah', phone: '0412 345 678' });
  await page.goto(`/jobs/${job.id}`);
  await expect(callSheet(page)).toContainText('Priya Shah');
  await page.keyboard.press('l');
  await logCall(page).getByRole('combobox', { name: 'Person' }).fill('priya shah');
  await page.keyboard.press('Tab');
  await logCall(page).getByLabel('Notes').fill('Second call');
  await page.keyboard.press('Control+Enter');
  await expect(logCall(page)).toBeHidden();
  await expect(page.getByRole('region', { name: 'People' }).getByText('Priya Shah')).toHaveCount(1);
  await expect(timeline(page)).toContainText('Call with Priya Shah: Second call');
});

test('Esc in the Person box closes the suggestions, not the dialog', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Atlassian', title: 'Engineer' });
  await page.goto(`/jobs/${job.id}`);
  await expect(callSheet(page)).toContainText('Atlassian');
  await page.keyboard.press('l');
  await logCall(page).getByRole('combobox', { name: 'Person' }).fill('Sam');
  const suggestions = logCall(page).getByRole('listbox', { name: 'People' });
  await expect(suggestions.getByRole('option', { name: 'New person: Sam' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(suggestions).toBeHidden();
  await expect(logCall(page)).toBeVisible();
  await expect(logCall(page).getByRole('combobox', { name: 'Person' })).toHaveValue('Sam');
});

test('Ctrl+K does nothing while a dialog is open', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Atlassian', title: 'Engineer' });
  await page.goto(`/jobs/${job.id}`);
  await expect(callSheet(page)).toContainText('Atlassian');
  await page.keyboard.press('l');
  await logCall(page).getByLabel('Notes').fill('Half-written notes');
  await page.keyboard.press('Control+k');
  await expect(logCall(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}$`));
});

test('Esc with notes typed asks before throwing them away', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Atlassian', title: 'Engineer' });
  await page.goto(`/jobs/${job.id}`);
  await expect(callSheet(page)).toContainText('Atlassian');
  await page.keyboard.press('l');
  await logCall(page).getByLabel('Notes').fill('Important details');
  page.once('dialog', (d) => void d.dismiss());
  await page.keyboard.press('Escape');
  await expect(logCall(page)).toBeVisible();
  await expect(logCall(page).getByLabel('Notes')).toHaveValue('Important details');
});

test('a note you were typing survives a jump to search', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Atlassian', title: 'Engineer' });
  await page.goto(`/jobs/${job.id}`);
  const box = page.getByRole('textbox', { name: 'Add a note' });
  await box.fill('Draft about the panel');
  await page.keyboard.press('Control+k');
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page.getByRole('textbox', { name: 'Add a note' })).toHaveValue('Draft about the panel');
});

test('pasting a job link into the search box starts a new job', async ({ page }) => {
  await page.goto('/');
  await copyToClipboard(page, 'https://www.seek.com.au/job/81234567');
  await searchBox(page).focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(newJob(page)).toBeVisible();
  await expect(newJob(page).getByLabel('Paste a job link or the ad text')).toHaveValue('https://www.seek.com.au/job/81234567');
});

test('pasting a phone number into the search box searches for it', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Atlassian', title: 'Engineer' });
  await seedCall(request, job.id, { name: 'Sam Lee', phone: '+61 412 345 678' });
  await page.goto('/');
  await copyToClipboard(page, '0412 345 678');
  await searchBox(page).focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(newJob(page)).toBeHidden();
  await expect(results(page).getByRole('option').first()).toContainText('Atlassian');
});
