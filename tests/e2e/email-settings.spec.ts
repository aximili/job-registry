import { expect, test } from '@playwright/test';
import { ORIGIN, reset } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

async function failMail(request: import('@playwright/test').APIRequestContext, fail: string | null) {
  await request.post('/__test/mail', { headers: { origin: ORIGIN }, data: { fail } });
}

test('saves the Gmail address and the app password, and never shows the password again', async ({ page, request }) => {
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Email' });
  await expect(section.getByRole('link', { name: 'myaccount.google.com/apppasswords' })).toHaveAttribute('rel', 'noreferrer');
  await section.getByLabel('Check Gmail for emails about your jobs').check();
  await section.getByLabel('Gmail address').fill('me@gmail.com');
  await section.getByRole('button', { name: 'Save email settings' }).click();
  await expect(page.getByText('Email settings saved.')).toBeVisible();

  await section.getByLabel('App password').fill('abcd efgh ijkl mnop');
  await section.getByRole('button', { name: 'Save password' }).click();
  await expect(section.getByText('An app password is saved.')).toBeVisible();
  await expect(section.getByLabel('App password')).toHaveCount(0);

  await page.reload();
  const again = page.getByRole('region', { name: 'Email' });
  await expect(again.getByText('An app password is saved.')).toBeVisible();
  await expect(again.getByLabel('Gmail address')).toHaveValue('me@gmail.com');
  await expect(again.getByLabel('Check Gmail for emails about your jobs')).toBeChecked();
  const settings = await (await request.get('/api/v1/settings')).text();
  expect(settings).not.toContain('abcd');
  expect(await (await request.get('/api/v1/settings/secrets')).json()).toEqual({ emailPassword: true });
});

test('Test connection says whether Gmail answered', async ({ page, request }) => {
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Email' });
  await section.getByLabel('Gmail address').fill('me@gmail.com');
  await section.getByLabel('App password').fill('abcdefghijklmnop');
  await section.getByRole('button', { name: 'Save password' }).click();
  // Unsaved changes are saved first, so the test uses what's on screen.
  await section.getByRole('button', { name: 'Test connection' }).click();
  await expect(section.getByText('Connected to imap.gmail.com as me@gmail.com.')).toBeVisible();

  await failMail(request, 'Gmail refused the address or app password.');
  await section.getByRole('button', { name: 'Test connection' }).click();
  await expect(section.getByText('Gmail refused the address or app password.')).toBeVisible();
});

test('Remove takes the app password away', async ({ page, request }) => {
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Email' });
  await section.getByLabel('App password').fill('abcdefghijklmnop');
  await section.getByRole('button', { name: 'Save password' }).click();
  await section.getByRole('button', { name: 'Remove' }).click();
  await expect(section.getByLabel('App password')).toBeVisible();
  expect(await (await request.get('/api/v1/settings/secrets')).json()).toEqual({ emailPassword: false });
});

test('Replace lets you paste a new app password, or keep the old one', async ({ page }) => {
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Email' });
  await section.getByLabel('App password').fill('abcdefghijklmnop');
  await section.getByRole('button', { name: 'Save password' }).click();
  await section.getByRole('button', { name: 'Replace' }).click();
  await expect(section.getByLabel('App password')).toBeFocused();
  await section.getByRole('button', { name: 'Cancel' }).click();
  await expect(section.getByText('An app password is saved.')).toBeVisible();
});

test('a typed app password counts for Test connection, so setup takes one press', async ({ page, request }) => {
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Email' });
  await section.getByLabel('Gmail address').fill('me@gmail.com');
  await section.getByLabel('App password').fill('abcd efgh ijkl mnop');
  await section.getByRole('button', { name: 'Test connection' }).click();
  await expect(section.getByText('Connected to imap.gmail.com as me@gmail.com.')).toBeVisible();
  await expect(section.getByText('An app password is saved.')).toBeVisible();
  expect(await (await request.get('/api/v1/settings/secrets')).json()).toEqual({ emailPassword: true });
});

test('Save email settings also saves a typed app password', async ({ page, request }) => {
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Email' });
  await section.getByLabel('Check Gmail for emails about your jobs').check();
  await section.getByLabel('Gmail address').fill('me@gmail.com');
  await section.getByLabel('App password').fill('abcdefghijklmnop');
  await section.getByLabel('Minutes between checks').fill('15');
  await section.getByRole('button', { name: 'Save email settings' }).click();
  await expect(section.getByText('An app password is saved.')).toBeVisible();
  expect(await (await request.get('/api/v1/settings/secrets')).json()).toEqual({ emailPassword: true });
  expect((await (await request.get('/api/v1/settings')).json()).email.pollMinutes).toBe(15);
});

test('the focus stays with you when the app password is saved, removed or kept', async ({ page }) => {
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Email' });
  await section.getByLabel('App password').fill('abcdefghijklmnop');
  await section.getByRole('button', { name: 'Save password' }).click();
  await expect(section.getByRole('button', { name: 'Replace' })).toBeFocused();
  await section.getByRole('button', { name: 'Replace' }).click();
  await section.getByRole('button', { name: 'Cancel' }).click();
  await expect(section.getByRole('button', { name: 'Replace' })).toBeFocused();
  await section.getByRole('button', { name: 'Remove' }).click();
  await expect(section.getByLabel('App password')).toBeFocused();
});

test('the Inbox link to Settings → Email lands on the Email heading', async ({ page }) => {
  await page.goto('/inbox');
  await page.getByRole('link', { name: 'Settings → Email' }).click();
  await expect(page.getByRole('heading', { name: 'Email', exact: true })).toBeFocused();
});
