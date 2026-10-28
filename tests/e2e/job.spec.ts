import { expect, test, type Page } from '@playwright/test';
import { localDate } from '../../shared/dates.ts';
import { formatDate } from '../../web/src/lib/format.ts';
import { patchJob, reset, seedJob } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

const today = () => formatDate(localDate(new Date()));
const callSheet = (page: Page) => page.getByRole('region', { name: 'Call sheet' });
const timeline = (page: Page) => page.getByRole('region', { name: 'Timeline' });
const statusPicker = (page: Page) => page.getByRole('combobox', { name: 'Status' });

test('shows the call sheet for a job', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Atlassian', title: 'Senior Software Engineer', location: 'Sydney NSW', status: 'applied' });
  await patchJob(request, job.id, { salary: { min: null, max: null, currency: null, period: null, text: '$185k–$200k + super' } });
  await page.goto(`/jobs/${job.id}`);
  const sheet = callSheet(page);
  await expect(sheet.getByRole('heading', { level: 1 })).toHaveText('Senior Software Engineer');
  await expect(sheet).toContainText('Atlassian');
  await expect(sheet).toContainText('Sydney NSW');
  await expect(sheet).toContainText('$185k–$200k + super');
  await expect(sheet).toContainText(today());
  await expect(statusPicker(page)).toHaveValue('applied');
});

test('changes status with S and shows it in the timeline', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Canva', title: 'Designer', status: 'applied' });
  await page.goto(`/jobs/${job.id}`);
  await expect(callSheet(page)).toContainText('Canva');
  await page.keyboard.press('s');
  await expect(statusPicker(page)).toBeFocused();
  await statusPicker(page).selectOption('interview_1');
  await expect(timeline(page)).toContainText('Applied → Interview 1');
});

test('moving to Applied sets the applied date to today', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Xero', title: 'Analyst' });
  await page.goto(`/jobs/${job.id}`);
  await expect(callSheet(page)).not.toContainText(today());
  await statusPicker(page).selectOption('applied');
  await expect(callSheet(page)).toContainText(today());
});

test('logs a call with a new person', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Atlassian', title: 'Engineer' });
  await page.goto(`/jobs/${job.id}`);
  await expect(callSheet(page)).toContainText('Atlassian');
  await page.keyboard.press('l');
  const dialog = page.getByRole('dialog', { name: 'Log a call' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Person' }).fill('Priya Shah');
  await dialog.getByRole('option', { name: 'New person: Priya Shah' }).click();
  await dialog.getByLabel('Phone').fill('0412 345 678');
  await dialog.getByLabel('Notes').fill('Panel next Tuesday');
  await page.keyboard.press('Control+Enter');
  await expect(dialog).toBeHidden();
  const people = page.getByRole('region', { name: 'People' });
  await expect(people).toContainText('Priya Shah');
  await expect(people).toContainText('0412 345 678');
  await expect(timeline(page)).toContainText('Call with Priya Shah: Panel next Tuesday');
});

test('adds a note with Ctrl+Enter', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Xero', title: 'Analyst' });
  await page.goto(`/jobs/${job.id}`);
  const box = page.getByRole('textbox', { name: 'Add a note' });
  await box.fill('They want someone who can start in January.');
  await box.press('Control+Enter');
  await expect(box).toHaveValue('');
  await expect(page.getByRole('region', { name: 'Notes' })).toContainText('They want someone who can start in January.');
});

test('edits fields with E and keeps them after reload', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Xero', title: 'Analyst' });
  await page.goto(`/jobs/${job.id}`);
  await expect(callSheet(page)).toContainText('Xero');
  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: 'Edit job' });
  await dialog.getByLabel('Salary').fill('$120k–$135k');
  await dialog.getByLabel('Location').fill('Melbourne VIC');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(callSheet(page)).toContainText('$120k–$135k');
  await expect(callSheet(page)).toContainText('Melbourne VIC');
});

test('shows the saved ad text with its line breaks', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Canva', title: 'Designer', jdText: 'About the role\nYou will design things.' });
  await page.goto(`/jobs/${job.id}`);
  const ad = page.getByRole('region', { name: 'Saved ad' });
  await expect(ad).toContainText('Ad pasted in');
  expect(await ad.locator('.ad-text').innerText()).toContain('About the role\nYou will design things.');
});

test('Esc goes back to the list', async ({ page, request }) => {
  const job = await seedJob(request, { company: 'Canva', title: 'Designer' });
  await page.goto(`/jobs/${job.id}`);
  await expect(callSheet(page)).toContainText('Canva');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('table', { name: 'Jobs' })).toContainText('Canva');
});
