import { expect, test } from '@playwright/test';
import { ORIGIN, reset } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test('saves the master profile, and it shows again after a reload', async ({ page, request }) => {
  await page.goto('/settings');
  const box = page.getByRole('textbox', { name: 'Master profile' });
  await box.fill('# Jo Citizen\nTen years of Go.');
  await page.getByRole('button', { name: 'Save master profile' }).click();
  await expect(page.getByRole('region', { name: 'Profile' }).getByText('Saved.')).toBeVisible();

  const res = await request.get('/api/v1/profile/master-profile');
  expect(((await res.json()) as { text: string }).text).toBe('# Jo Citizen\nTen years of Go.');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Master profile' })).toHaveValue('# Jo Citizen\nTen years of Go.');
});

test('Save stays off until you change something', async ({ page }) => {
  await page.goto('/settings');
  const save = page.getByRole('button', { name: 'Save preferences' });
  await expect(save).toBeDisabled();
  await page.getByRole('textbox', { name: 'Preferences' }).fill('Remote only.');
  await expect(save).toBeEnabled();
});

test('the templates section shows the starter resume template', async ({ page }) => {
  await page.goto('/settings#templates');
  const templates = page.getByRole('region', { name: 'Templates' });
  await expect(templates.getByRole('textbox', { name: 'resume.css' })).toHaveValue(/@page/);
  await expect(templates.getByRole('textbox', { name: 'cover-letter.css' })).toHaveValue(/@page/);
});

test('an empty master profile shows an example of what to paste', async ({ page, request }) => {
  await request.put('/api/v1/profile/master-profile', { headers: { origin: ORIGIN }, data: { text: '' } });
  await page.goto('/settings');
  await expect(page.getByRole('textbox', { name: 'Master profile' })).toHaveAttribute('placeholder', /# Your Name/);
});

test('leaving Settings with unsaved profile text asks first', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('textbox', { name: 'Master profile' }).fill('# Jo Citizen\nPasted, not saved yet.');
  let asked = '';
  page.once('dialog', (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await page.getByRole('link', { name: 'Job Registry' }).click();
  expect(asked).toContain('not saved');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('textbox', { name: 'Master profile' })).toHaveValue('# Jo Citizen\nPasted, not saved yet.');
});
