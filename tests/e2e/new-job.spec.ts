import { expect, test, type Page } from '@playwright/test';
import { localDate } from '../../shared/dates.ts';
import { formatDate } from '../../web/src/lib/format.ts';
import { ORIGIN, reset, seedJob } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

const dialog = (page: Page) => page.getByRole('dialog', { name: 'New job' });
const pasteBox = (page: Page) => dialog(page).getByLabel('Paste a job link or the ad text');

async function openNewJob(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /New job/ }).click();
  await expect(dialog(page)).toBeVisible();
}

test('saves pasted ad text as a new job', async ({ page }) => {
  await openNewJob(page);
  await pasteBox(page).fill('Data Analyst\nXero\nWe are hiring a data analyst in Melbourne.');
  await dialog(page).getByRole('button', { name: 'Continue' }).click();
  await dialog(page).getByLabel('Role').fill('Data Analyst');
  await dialog(page).getByLabel('Company').fill('Xero');
  await dialog(page).getByLabel('Status').selectOption('applied');
  await dialog(page).getByRole('button', { name: 'Save job' }).click();
  await expect(page).toHaveURL(/\/jobs\/\d+$/);
  const sheet = page.getByRole('region', { name: 'Call sheet' });
  await expect(sheet.getByRole('heading', { level: 1 })).toHaveText('Data Analyst');
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('applied');
  await expect(sheet).toContainText(formatDate(localDate(new Date())));
});

test('N opens the new job dialog when you are not typing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search jobs' }).blur();
  await page.keyboard.press('n');
  await expect(dialog(page)).toBeVisible();
});

test('a pasted link fills the form from JobPosting data', async ({ page }) => {
  await openNewJob(page);
  await pasteBox(page).fill('http://127.0.0.1:4798/job.html');
  await dialog(page).getByRole('button', { name: 'Continue' }).click();
  await expect(dialog(page).getByLabel('Role')).toHaveValue('Platform Engineer');
  await expect(dialog(page).getByLabel('Company')).toHaveValue('Canva');
  await expect(dialog(page).getByLabel('Location')).toHaveValue('Sydney NSW');
});

test('a blocked link shows the warning', async ({ page }) => {
  await openNewJob(page);
  await pasteBox(page).fill('http://127.0.0.1:4798/blocked');
  await dialog(page).getByRole('button', { name: 'Continue' }).click();
  await expect(dialog(page)).toContainText(
    "That site didn't let the app download this page. Copy the ad text from your browser and paste it here instead.",
  );
});

test('asks "Same job?" for a likely duplicate, and Same job links the ad', async ({ page, request }) => {
  const existing = await seedJob(request, { company: 'Atlassian', title: 'Senior Engineer', status: 'applied' });
  await openNewJob(page);
  await pasteBox(page).fill('The same role, posted again.');
  await dialog(page).getByRole('button', { name: 'Continue' }).click();
  await dialog(page).getByLabel('Role').fill('Senior Engineer');
  await dialog(page).getByLabel('Company').fill('Atlassian Pty Ltd');
  await dialog(page).getByRole('button', { name: 'Save job' }).click();
  await expect(dialog(page)).toContainText('Looks like Senior Engineer at Atlassian');
  await dialog(page).getByRole('button', { name: 'Same job' }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${existing.id}$`));
  await expect(page.getByRole('status')).toContainText('Added this ad to the existing job.');
  await expect(page.getByRole('region', { name: 'Saved ad' }).getByText('Ad pasted in')).toHaveCount(2);
});

test('Different job creates a second job', async ({ page, request }) => {
  const existing = await seedJob(request, { company: 'Atlassian', title: 'Senior Engineer' });
  await openNewJob(page);
  await pasteBox(page).fill('A different team, same title.');
  await dialog(page).getByRole('button', { name: 'Continue' }).click();
  await dialog(page).getByLabel('Role').fill('Senior Engineer');
  await dialog(page).getByLabel('Company').fill('Atlassian');
  await dialog(page).getByRole('button', { name: 'Save job' }).click();
  await dialog(page).getByRole('button', { name: 'Different job' }).click();
  await expect(page).toHaveURL(/\/jobs\/\d+$/);
  expect(page.url()).not.toMatch(new RegExp(`/jobs/${existing.id}$`));
});

// A real copy and paste with key presses. Firefox empties the clipboard of
// a scripted paste event, so a fake event can't stand in for the real thing.
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
  await page.evaluate(() => {
    document.getElementById('scratch')?.remove();
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

test('pasting outside a field opens the dialog with the text', async ({ page }) => {
  await page.goto('/');
  await copyToClipboard(page, 'Pasted ad text for a role');
  await page.keyboard.press('ControlOrMeta+V');
  await expect(dialog(page)).toBeVisible();
  await expect(pasteBox(page)).toHaveValue('Pasted ad text for a role');
});

test('double-clicking Save creates only one job', async ({ page, request }) => {
  await openNewJob(page);
  await pasteBox(page).fill('An ad that should only be saved once.');
  await dialog(page).getByRole('button', { name: 'Continue' }).click();
  await dialog(page).getByLabel('Role').fill('Once Only Role');
  await dialog(page).getByRole('button', { name: 'Save job' }).dblclick();
  await expect(page).toHaveURL(/\/jobs\/\d+$/);
  const res = await request.get('/api/v1/jobs?status=all', { headers: { origin: ORIGIN } });
  const jobs = (await res.json()) as { title: string }[];
  expect(jobs.filter((j) => j.title === 'Once Only Role')).toHaveLength(1);
});
