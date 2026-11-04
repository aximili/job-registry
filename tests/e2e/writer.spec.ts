// The AI that writes your documents, in Settings → AI: picking one and going
// back to the AI in use, by keyboard alone, quick changes that save once, a
// change saved at once when you leave the list or the page, a refused pick,
// a pick from another tab, saving or copying an AI while another one writes,
// deleting the AI that writes, and the sentence when the writer isn't saved
// any more. The fake AI answers for every AI, so no request leaves this computer.

import { expect, test, type Page } from '@playwright/test';
import type { Settings } from '../../shared/contracts/index.ts';
import { ORIGIN, reset, savedSettings, seedCloudAi } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

const HELP = 'Resumes, cover letters, briefs and prep plans. Ratings, quick marks, reading ads and reading emails stay on the AI in use.';

const section = (page: Page) => page.getByRole('region', { name: 'AI', exact: true });
const writes = (page: Page) => section(page).getByLabel('Writes your documents');
const picked = (page: Page) => writes(page).locator('option:checked');
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const savedWriter = async (page: Page) => (await savedSettings(page.request)).settings.ai.writer;

// Two changes, or one, straight after each other in the page, as an arrow
// key makes them on a closed list on Windows. Nothing gets the focus.
async function change(page: Page, values: string[]) {
  await writes(page).evaluate((el, all) => {
    const select = el as HTMLSelectElement;
    for (const value of all) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, values);
}

// From here the page's clock stands still, so the 400 ms wait never ends on
// its own: only leaving the list or the page saves.
async function stopTheClock(page: Page) {
  await page.clock.pauseAt(Date.now() + 60_000);
}

async function useWriter(page: Page, id: string | null) {
  const res = await page.request.put('/api/v1/settings/ai/writer', { headers: { origin: ORIGIN }, data: { id } });
  expect(res.ok()).toBe(true);
}

test('pick Claude – mine to write, keep it after a reload, then go back to the AI in use', async ({ page }) => {
  await seedCloudAi(page.request);
  await page.goto('/settings#ai');
  await expect(writes(page)).toHaveAccessibleDescription(HELP);
  await expect(writes(page).locator('option')).toHaveText(['The AI in use (Bonsai 2)', 'Bonsai 2', 'Claude – mine']);
  await expect(picked(page)).toHaveText('The AI in use (Bonsai 2)');

  await writes(page).selectOption({ label: 'Claude – mine' });
  await expect(toast(page, 'Claude – mine writes your documents now.')).toBeVisible();
  expect(await savedWriter(page)).toBe('claude-mine');
  // Writing with another AI never switches the AI in use.
  await expect(page.getByRole('button', { name: /AI in use$/ })).toHaveAccessibleName(/^Bonsai 2, /);
  await expect(section(page).getByRole('listitem').filter({ hasText: 'Bonsai 2' }).first()).toContainText('In use');

  await page.reload();
  await expect(picked(page)).toHaveText('Claude – mine');

  await writes(page).selectOption({ label: 'The AI in use (Bonsai 2)' });
  await expect(toast(page, 'The AI in use writes your documents now.')).toBeVisible();
  expect(await savedWriter(page)).toBeNull();
});

test('by keyboard alone: Tab to the list and pick with a letter', async ({ page }) => {
  await seedCloudAi(page.request);
  await page.goto('/settings#ai');
  // From the section's heading, the list is the first thing Tab reaches.
  await section(page).getByRole('heading', { name: 'AI', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(writes(page)).toBeFocused();

  // A letter picks the first AI whose name starts with it, without opening the list.
  await page.keyboard.press('c');
  await expect(toast(page, 'Claude – mine writes your documents now.')).toBeVisible();
  expect(await savedWriter(page)).toBe('claude-mine');
  await expect(writes(page)).toBeFocused();

  // A browser joins letters typed within about a second into one search
  // ("ct" matches nothing), so wait as a person would before the next.
  await page.waitForTimeout(1_200);
  await page.keyboard.press('t');
  await expect(toast(page, 'The AI in use writes your documents now.')).toBeVisible();
  expect(await savedWriter(page)).toBeNull();
  await expect(writes(page)).toBeFocused();
});

test('two quick changes save once, with the last one', async ({ page }) => {
  await seedCloudAi(page.request);
  await page.goto('/settings#ai');
  await expect(picked(page)).toHaveText('The AI in use (Bonsai 2)');
  const sent: unknown[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PUT' && req.url().endsWith('/api/v1/settings/ai/writer')) sent.push(req.postDataJSON());
  });
  await change(page, ['bonsai-2', 'claude-mine']);
  await expect(toast(page, 'Claude – mine writes your documents now.')).toBeVisible();
  expect(sent).toEqual([{ id: 'claude-mine' }]);
  expect(await savedWriter(page)).toBe('claude-mine');
});

test('leaving the list saves the change at once', async ({ page }) => {
  await seedCloudAi(page.request);
  await page.clock.install();
  await page.goto('/settings#ai');
  await expect(picked(page)).toHaveText('The AI in use (Bonsai 2)');
  await stopTheClock(page);
  await writes(page).focus();
  await page.keyboard.press('c');
  await expect(picked(page)).toHaveText('Claude – mine');
  expect(await savedWriter(page)).toBeNull();
  await page.keyboard.press('Tab');
  await expect(toast(page, 'Claude – mine writes your documents now.')).toBeVisible();
  expect(await savedWriter(page)).toBe('claude-mine');
});

test("a pick made just before the page reloads isn't lost", async ({ page }) => {
  await seedCloudAi(page.request);
  await page.clock.install();
  await page.goto('/settings#ai');
  await expect(picked(page)).toHaveText('The AI in use (Bonsai 2)');
  await stopTheClock(page);
  await change(page, ['claude-mine']);
  expect(await savedWriter(page)).toBeNull();
  await page.reload();
  await expect.poll(() => savedWriter(page)).toBe('claude-mine');
  await page.clock.resume();
  await page.reload();
  await expect(picked(page)).toHaveText('Claude – mine');
});

test('a refused pick says why, and the list shows what is saved again', async ({ page }) => {
  await seedCloudAi(page.request);
  await page.route('**/api/v1/settings/ai/writer', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'validation', message: "There's no saved AI with that id." } }),
    }),
  );
  await page.goto('/settings#ai');
  await writes(page).selectOption({ label: 'Claude – mine' });
  await expect(toast(page, "There's no saved AI with that id.")).toBeVisible();
  await expect(picked(page)).toHaveText('The AI in use (Bonsai 2)');
  expect(await savedWriter(page)).toBeNull();
});

test('a writer picked in another tab shows here too', async ({ page }) => {
  await seedCloudAi(page.request);
  // Once the page listens for changes.
  const listening = page.waitForResponse((res) => res.url().endsWith('/api/v1/events'));
  await page.goto('/settings#ai');
  await listening;
  await expect(picked(page)).toHaveText('The AI in use (Bonsai 2)');
  await useWriter(page, 'claude-mine');
  await expect(picked(page)).toHaveText('Claude – mine');
  await useWriter(page, null);
  await expect(picked(page)).toHaveText('The AI in use (Bonsai 2)');
});

test('saving or copying an AI while another AI writes keeps that one writing', async ({ page }) => {
  await seedCloudAi(page.request);
  await useWriter(page, 'claude-mine');
  await page.goto('/settings#ai');
  await expect(picked(page)).toHaveText('Claude – mine');
  const ai = section(page);

  // The AI in use, edited and saved.
  await ai.getByLabel('Temperature for Rating a job').fill('0.5');
  await ai.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(toast(page, 'AI settings saved.')).toBeVisible();
  expect((await savedSettings(page.request)).ai.tasks.rate.temperature).toBe(0.5);
  expect(await savedWriter(page)).toBe('claude-mine');

  // The AI that writes, renamed: it keeps its id, so it still writes.
  await ai.getByRole('button', { name: /^Claude – mine/ }).click();
  await ai.getByLabel('Name').fill('Claude – work');
  await ai.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(toast(page, 'AI settings saved.')).toBeVisible();
  expect(await savedWriter(page)).toBe('claude-mine');
  await expect(picked(page)).toHaveText('Claude – work');

  // A copy is saved at once, and the writer stays.
  await ai.getByRole('button', { name: 'Duplicate Bonsai 2' }).click();
  await expect(toast(page, 'Added Bonsai 2 (copy).')).toBeVisible();
  expect(await savedWriter(page)).toBe('claude-mine');
  await expect(picked(page)).toHaveText('Claude – work');
});

test('deleting the AI that writes says so first, and then the AI in use writes', async ({ page }) => {
  await seedCloudAi(page.request);
  await useWriter(page, 'claude-mine');
  await page.goto('/settings#ai');
  await expect(picked(page)).toHaveText('Claude – mine');
  const asked: string[] = [];
  page.once('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  await section(page).getByRole('button', { name: 'Delete Claude – mine' }).click();
  await expect(toast(page, 'Deleted Claude – mine.')).toBeVisible();
  expect(asked).toEqual([
    'Delete Claude – mine? Its API key is deleted too. Claude – mine also writes your documents. After this, the AI in use writes them.',
  ]);
  expect(await savedWriter(page)).toBeNull();
  await expect(writes(page).locator('option')).toHaveText(['The AI in use (Bonsai 2)', 'Bonsai 2']);
  await expect(picked(page)).toHaveText('The AI in use (Bonsai 2)');
});

test("a writing AI that isn't saved any more says who writes instead", async ({ page }) => {
  // A hand edit of settings.json can leave one. The server sets it to none
  // at the next save, so this tab is shown such a file.
  await page.route('**/api/v1/settings', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const settings = (await res.json()) as Settings;
    await route.fulfill({ response: res, json: { ...settings, ai: { ...settings.ai, writer: 'an-old-ai' } } });
  });
  await page.goto('/settings#ai');
  const fallback = "Your writing AI isn't saved any more, so Bonsai 2, the AI in use, writes.";
  await expect(section(page)).toContainText(fallback);
  await expect(picked(page)).toHaveText('The AI in use (Bonsai 2)');
  // The list's description says it too.
  await expect(writes(page)).toHaveAccessibleDescription(`${HELP} ${fallback}`);
});
