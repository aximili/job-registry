import { expect, test, type APIRequestContext } from '@playwright/test';
import { formatDate, localDate } from '../../shared/dates.ts';
import { ORIGIN, reset, seedJob } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

// A local date some days from today, as the app shows it ("5 Nov 2026").
function day(offset: number): { local: string; shown: string } {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const local = localDate(d);
  return { local, shown: formatDate(local) };
}

async function followUp(request: APIRequestContext, id: number, offset: number, note?: string) {
  const res = await request.put(`/api/v1/jobs/${id}/follow-up`, { headers: { origin: ORIGIN }, data: { on: day(offset).local, note } });
  if (!res.ok()) throw new Error(`followUp failed: ${res.status()}`);
}

test('set a follow-up with a quick pick, and it shows on the call sheet and the home page', async ({ page, request }) => {
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await page.goto(`/jobs/${job.id}`);
  const sheet = page.getByRole('region', { name: 'Call sheet' });
  await sheet.getByRole('button', { name: /^Follow up/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Follow up' });
  await dialog.getByRole('button', { name: 'In a week' }).click();
  await expect(dialog.getByLabel('Follow up on')).toHaveValue(day(7).local);
  await dialog.getByLabel('Reason (optional)').fill('Chase Sam');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`Follow-up saved for ${day(7).shown}.`)).toBeVisible();
  await expect(sheet).toContainText(`Follow up: ${day(7).shown} · Chase Sam`);

  await page.goto('/');
  const section = page.getByRole('region', { name: 'Follow up' });
  await expect(section.getByRole('heading', { name: 'Coming up' })).toBeVisible();
  await expect(section.getByRole('link', { name: 'Senior Engineer at Atlassian' })).toBeVisible();
  await expect(section).toContainText(day(7).shown);
  await expect(section).toContainText('Chase Sam');
});

test('Done clears it from the home page and the call sheet, and the focus moves on', async ({ page, request }) => {
  const first = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
  const second = await seedJob(request, { title: 'Designer', company: 'Canva' });
  await followUp(request, first.id, -2);
  await followUp(request, second.id, -1);
  await page.goto('/');
  const section = page.getByRole('region', { name: 'Follow up' });
  await expect(section.getByRole('heading', { name: 'Due' })).toBeVisible();
  await section.getByRole('button', { name: 'Done: Senior Engineer at Atlassian' }).click();
  await expect(page.getByText('Done: Senior Engineer at Atlassian.')).toBeVisible();
  await expect(section.getByRole('link', { name: 'Senior Engineer at Atlassian' })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Done: Designer at Canva' })).toBeFocused();
  await section.getByRole('button', { name: 'Done: Designer at Canva' }).click();
  await expect(section).toContainText('Nothing to follow up.');
  await expect(section.getByRole('heading', { name: 'Follow up' })).toBeFocused();

  await page.goto(`/jobs/${first.id}`);
  const sheet = page.getByRole('region', { name: 'Call sheet' });
  await expect(sheet.getByRole('button', { name: /^Follow up/ })).toBeVisible();
  await expect(sheet).not.toContainText('Follow up:');
});

test('F opens the dialog, and Escape closes it', async ({ page, request }) => {
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
  await page.goto(`/jobs/${job.id}`);
  await page.keyboard.press('f');
  const dialog = page.getByRole('dialog', { name: 'Follow up' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Clear takes the follow-up away', async ({ page, request }) => {
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
  await followUp(request, job.id, 3, 'Chase');
  await page.goto(`/jobs/${job.id}`);
  const sheet = page.getByRole('region', { name: 'Call sheet' });
  await sheet.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('dialog', { name: 'Follow up' }).getByRole('button', { name: 'Clear' }).click();
  await expect(sheet.getByRole('button', { name: /^Follow up/ })).toBeVisible();
  const saved = await (await request.get(`/api/v1/jobs/${job.id}`)).json();
  expect(saved).toMatchObject({ followUpOn: null, followUpNote: null });
});

test('a late follow-up says how late', async ({ page, request }) => {
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
  await followUp(request, job.id, -3);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Follow up' })).toContainText('3 days late');
  await page.goto(`/jobs/${job.id}`);
  await expect(page.getByRole('region', { name: 'Call sheet' })).toContainText('3 days late');
});

test('nothing due and nothing coming up shows no section', async ({ page, request }) => {
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
  await followUp(request, job.id, 30);
  await page.goto('/');
  await expect(page.getByRole('table', { name: 'Jobs' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Follow up' })).toHaveCount(0);
});

test('the call sheet keeps the focus through Save, Done and Clear', async ({ page, request }) => {
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
  await page.goto(`/jobs/${job.id}`);
  const sheet = page.getByRole('region', { name: 'Call sheet' });
  await sheet.getByRole('button', { name: /^Follow up/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Follow up' });
  await dialog.getByRole('button', { name: 'Tomorrow' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByRole('button', { name: 'Change follow-up' })).toBeFocused();

  await sheet.getByRole('button', { name: 'Done with the follow-up' }).click();
  await expect(sheet.getByRole('button', { name: /^Follow up/ })).toBeFocused();

  await followUp(request, job.id, 2);
  await page.reload();
  await sheet.getByRole('button', { name: 'Change follow-up' }).click();
  await dialog.getByRole('button', { name: 'Clear' }).click();
  await expect(sheet.getByRole('button', { name: /^Follow up/ })).toBeFocused();
});

test('saving with no day asks for one, and only offers Clear when there is something to clear', async ({ page, request }) => {
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
  await page.goto(`/jobs/${job.id}`);
  await page.getByRole('region', { name: 'Call sheet' }).getByRole('button', { name: /^Follow up/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Follow up' });
  await expect(dialog.getByRole('button', { name: 'Clear' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Pick a day.');
  await expect(dialog.getByLabel('Follow up on')).toBeFocused();
});

test('a follow-up due today says so in lower case, and F is still shown', async ({ page, request }) => {
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
  await followUp(request, job.id, 0, 'Chase Sam');
  await page.goto(`/jobs/${job.id}`);
  const sheet = page.getByRole('region', { name: 'Call sheet' });
  await expect(sheet).toContainText(`Follow up: ${day(0).shown} · Chase Sam (today)`);
  await expect(sheet.getByRole('button', { name: 'Change follow-up' })).toContainText('F');
});
