// Several AIs: adding one with a key, testing it before it's saved,
// duplicating it, switching from the AI pill by mouse and by keyboard,
// testing an AI that isn't in use, removing a key, and deleting. The fake AI
// answers for every AI, so no request leaves this computer.

import { expect, test, type Page } from '@playwright/test';
import { ORIGIN, reset, savedSettings, seedCloudAi, seedJob, setAiMode } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

const KEY = 'sk-ant-e2e-0123456789abcdef';

const section = (page: Page) => page.getByRole('region', { name: 'AI', exact: true });
const pill = (page: Page) => page.getByRole('button', { name: /AI in use$/ });
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const secrets = async (page: Page) => (await (await page.request.get('/api/v1/settings/secrets')).json()) as { aiKeys: string[] };

// Opens a saved AI in the form under My AIs.
async function openAi(page: Page, name: string) {
  await section(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(section(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

test('add Claude from its preset with a key, test it before it is saved, then save it', async ({ page }) => {
  await page.goto('/settings#ai');
  const ai = section(page);
  await ai.getByRole('button', { name: 'Add an AI' }).click();
  await expect(ai.getByLabel('Provider')).toBeFocused();
  await ai.getByLabel('Provider').selectOption('anthropic');
  await expect(ai.getByLabel('Server address')).toHaveValue('https://api.anthropic.com/v1');
  await expect(ai.getByLabel('Model', { exact: true })).toHaveValue('claude-sonnet-5-5');
  await expect(ai).toContainText("Claude sees your profile, the ads you save and rate, and (if email is on) your emails.");
  await expect(ai.getByRole('link', { name: /^Get a key/ })).toHaveAttribute('href', /^https:\/\//);
  await ai.getByLabel('Name').fill('Claude – mine');
  await ai.getByLabel('API key').fill(KEY);

  // Test connection tries what's on screen, and saves nothing.
  await ai.getByRole('button', { name: 'Test connection' }).click();
  await expect(ai.getByRole('status')).toContainText(/Connected to Claude \(Anthropic API\)\. It replied in \d+ ms\./);
  expect((await savedSettings(page.request)).settings.ai.saved.map((one) => one.name)).toEqual(['Bonsai 2']);
  expect((await secrets(page)).aiKeys).toEqual([]);
  await pill(page).click();
  await expect(page.getByRole('menuitemradio')).toHaveCount(1);
  await expect(page.getByRole('menuitemradio', { name: /^Claude/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await ai.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(toast(page, 'Added Claude – mine.')).toBeVisible();
  await expect(ai.getByText('Key saved')).toBeVisible();
  await expect(ai.getByRole('button', { name: 'Replace' })).toBeVisible();
  // The key went to the server, and never comes back to the page.
  expect((await secrets(page)).aiKeys).toEqual(['claude-mine']);
  expect(await page.content()).not.toContain(KEY);
  expect(await page.locator('input').evaluateAll((all) => all.map((el) => (el as HTMLInputElement).value))).not.toContain(KEY);
  expect(JSON.stringify(await (await page.request.get('/api/v1/settings')).json())).not.toContain(KEY);
  // Adding an AI never switches to it.
  await expect(pill(page)).toHaveAccessibleName(/^Bonsai 2, .*AI in use$/);
  await expect(ai.getByRole('button', { name: 'Use this: Claude – mine' })).toBeVisible();
});

test('Duplicate makes "(copy)" with every setting but no key', async ({ page }) => {
  await seedCloudAi(page.request, KEY);
  await page.goto('/settings#ai');
  const ai = section(page);
  await ai.getByRole('button', { name: 'Duplicate Claude – mine' }).click();
  await expect(toast(page, 'Added Claude – mine (copy). Rename it and give it its own API key.')).toBeVisible();
  await expect(ai.getByRole('heading', { name: 'Claude – mine (copy)', exact: true })).toBeVisible();
  await expect(ai.getByLabel('Name')).toBeFocused();
  await expect(ai.getByLabel('API key')).toBeVisible();
  await expect(ai.getByText('Key saved')).toHaveCount(0);
  await expect(ai.getByRole('listitem').filter({ hasText: 'Claude – mine (copy)' })).toContainText('No API key yet');
  const { settings } = await savedSettings(page.request);
  expect(settings.ai.saved.map((one) => one.name)).toEqual(['Bonsai 2', 'Claude – mine', 'Claude – mine (copy)']);
  expect((await secrets(page)).aiKeys).toEqual(['claude-mine']);
});

test('switch from the AI pill by mouse, then back by keyboard alone', async ({ page }) => {
  await seedCloudAi(page.request);
  await page.goto('/');
  await expect(pill(page)).toHaveAccessibleName(/^Bonsai 2, .*AI in use$/);

  await pill(page).click();
  const menu = page.getByRole('menu', { name: 'Switch the AI' });
  await expect(menu.getByRole('group', { name: 'On this computer' })).toContainText('Bonsai 2');
  await expect(menu.getByRole('group', { name: 'Cloud' })).toContainText('Claude – mine');
  await expect(menu.getByRole('menuitemradio', { name: /^Bonsai 2/ })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: /^Claude – mine/ }).click();
  await expect(toast(page, 'Now using Claude – mine.')).toBeVisible();
  await expect(pill(page)).toHaveAccessibleName(/^Claude – mine, .*AI in use$/);
  await expect(pill(page)).toContainText('Claude – mine');
  await expect(menu).toHaveCount(0);
  expect((await savedSettings(page.request)).settings.ai.active).toBe('claude-mine');

  // Keyboard alone: Shift+Tab from New job reaches the pill. Enter opens the
  // menu on the AI in use, Escape closes it again.
  await page.getByRole('button', { name: /^New job/ }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(pill(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitemradio', { name: /^Claude – mine/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(pill(page)).toBeFocused();
  // Bonsai 2 is listed first (this computer), one arrow up from Claude.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitemradio', { name: /^Bonsai 2/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toast(page, 'Now using Bonsai 2.')).toBeVisible();
  await expect(pill(page)).toHaveAccessibleName(/^Bonsai 2, .*AI in use$/);
  await expect(pill(page)).toBeFocused();
  expect((await savedSettings(page.request)).settings.ai.active).toBe('bonsai-2');
});

test('Settings → AI switches too, and an AI problem shows at the top of the menu', async ({ page }) => {
  await seedCloudAi(page.request);
  await setAiMode(page.request, 'fail');
  await seedJob(page.request, { jdText: 'Data Analyst\nXero' });
  await page.goto('/');
  await expect(pill(page)).toHaveAccessibleName('Bonsai 2, problem, AI in use', { timeout: 10_000 });
  await pill(page).click();
  await expect(page.getByRole('menu', { name: 'Switch the AI' })).toHaveAccessibleDescription(/^Can't reach the AI at /);
  await page.getByRole('menuitem', { name: 'Manage AIs…' }).click();
  await expect(page).toHaveURL(/\/settings#ai$/);

  await section(page).getByRole('button', { name: 'Use this: Claude – mine' }).click();
  await expect(toast(page, 'Now using Claude – mine.')).toBeVisible();
  await expect(section(page).getByRole('listitem').filter({ hasText: 'Claude – mine' })).toContainText('In use');
  await expect(pill(page)).toHaveAccessibleName(/^Claude – mine, .*AI in use$/);
});

test('Test connection on an AI that is not in use leaves the AI in use as it is', async ({ page }) => {
  await seedCloudAi(page.request);
  await page.goto('/settings#ai');
  await openAi(page, 'Claude – mine');
  await section(page).getByRole('button', { name: 'Test connection' }).click();
  await expect(section(page).getByRole('status')).toContainText(/Connected to Claude \(Anthropic API\)\. It replied in \d+ ms\./);
  await expect(pill(page)).toHaveAccessibleName(/^Bonsai 2, .*AI in use$/);
  expect((await savedSettings(page.request)).settings.ai.active).toBe('bonsai-2');
  // The result was for the model tested: a different model hides it.
  await section(page).getByLabel('Model', { exact: true }).fill('claude-opus-5-5');
  await expect(section(page).getByRole('status')).toHaveCount(0);
});

test('Remove takes the key away; Delete waits until you switch, then asks', async ({ page }) => {
  await seedCloudAi(page.request, KEY);
  await page.goto('/settings#ai');
  const ai = section(page);
  await openAi(page, 'Claude – mine');
  await expect(ai.getByText('Key saved')).toBeVisible();
  await ai.getByRole('button', { name: 'Remove' }).click();
  await expect(toast(page, 'API key removed.')).toBeVisible();
  await expect(ai.getByText('Key saved')).toHaveCount(0);
  await expect(ai.getByLabel('API key')).toBeFocused();
  expect((await secrets(page)).aiKeys).toEqual([]);

  // The AI in use can't be deleted: the button says why.
  const deleteInUse = ai.getByRole('button', { name: 'Delete Bonsai 2' });
  await expect(deleteInUse).toHaveAttribute('aria-disabled', 'true');
  await expect(deleteInUse).toHaveAttribute('title', 'Switch to another AI first.');
  await expect(deleteInUse).toHaveAttribute('aria-describedby', /.+/);
  await expect(deleteInUse).toHaveAccessibleDescription('Switch to another AI first.');
  // It still takes a click (Playwright won't click an aria-disabled button without force).
  await deleteInUse.click({ force: true });
  await expect(toast(page, 'Switch to another AI first.')).toBeVisible();

  // Any other AI asks first.
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe('Delete Claude – mine?');
    void dialog.accept();
  });
  await ai.getByRole('button', { name: 'Delete Claude – mine' }).click();
  await expect(toast(page, 'Deleted Claude – mine.')).toBeVisible();
  await expect(ai.getByRole('listitem')).toHaveCount(1);
  expect((await savedSettings(page.request)).settings.ai.saved.map((one) => one.id)).toEqual(['bonsai-2']);
});

test('the pill starts with what it shows, and says only "AI" until it knows which AI is in use', async ({ page }) => {
  await seedCloudAi(page.request);
  expect((await page.request.put('/api/v1/settings/ai/active', { headers: { origin: ORIGIN }, data: { id: 'claude-mine' } })).ok()).toBe(true);
  let release = () => {};
  const gate = new Promise<void>((done) => (release = done));
  for (const url of ['**/api/v1/settings', '**/api/v1/ai/status']) {
    await page.route(url, async (route) => {
      await gate;
      await route.continue();
    });
  }
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'AI', exact: true })).toBeVisible();
  await expect(page.getByRole('banner').getByText('Bonsai 2')).toHaveCount(0);
  release();
  await expect(pill(page)).toHaveAccessibleName(/^Claude – mine, .*AI in use$/);
  // The visible words come first in its name: "Claude – mine · off" is read as "Claude – mine, off, AI in use".
  await expect(pill(page)).toContainText('Claude – mine');
});

test('an open menu keeps page shortcuts out, finds an AI by its first letter, and closes when the focus leaves it', async ({ page }) => {
  await seedCloudAi(page.request);
  await page.goto('/');
  await pill(page).click();
  const menu = page.getByRole('menu', { name: 'Switch the AI' });
  await expect(menu.getByRole('menuitemradio', { name: /^Bonsai 2/ })).toBeFocused();
  // N (new job) and / (search) belong to the page, not to an open menu.
  await page.keyboard.press('n');
  await page.keyboard.press('/');
  await expect(page.getByRole('dialog', { name: 'New job' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Search jobs' })).not.toBeFocused();
  await expect(menu).toBeVisible();
  // A letter moves to the AI whose name starts with it.
  await page.keyboard.press('c');
  await expect(menu.getByRole('menuitemradio', { name: /^Claude – mine/ })).toBeFocused();
  // The focus leaving the menu any other way closes it.
  await page.getByRole('combobox', { name: 'Search jobs' }).focus();
  await expect(menu).toHaveCount(0);
});

test('changing a provider warns that the saved key goes, and saving removes it', async ({ page }) => {
  await seedCloudAi(page.request, KEY);
  await page.goto('/settings#ai');
  const ai = section(page);
  await openAi(page, 'Claude – mine');
  const warning = 'The key saved for Claude (Anthropic API) is removed when you save.';
  // Even to a provider that takes no key at all.
  await ai.getByLabel('Provider').selectOption('ollama');
  await expect(ai.getByText(warning)).toBeVisible();
  await ai.getByLabel('Provider').selectOption('openai');
  await expect(ai.getByText(warning)).toBeVisible();
  // The saved key isn't offered for the new provider ("Key saved" and Replace go).
  await expect(ai.getByRole('button', { name: 'Replace' })).toHaveCount(0);
  await ai.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(toast(page, 'AI settings saved.')).toBeVisible();
  expect((await secrets(page)).aiKeys).toEqual([]);
  await expect(ai.getByLabel('API key')).toBeVisible();
  await expect(ai.getByRole('listitem').filter({ hasText: 'Claude – mine' })).toContainText('No API key yet');
});

test('a tab that never learnt about the key still never sends it to a new provider', async ({ page }) => {
  await seedCloudAi(page.request, KEY);
  // This tab can't tell which AIs have a key.
  await page.route('**/api/v1/settings/secrets', (route) => (route.request().method() === 'GET' ? route.abort() : route.continue()));
  await page.goto('/settings#ai');
  await openAi(page, 'Claude – mine');
  await section(page).getByLabel('Provider').selectOption('openai');
  await section(page).getByRole('button', { name: 'Save AI settings' }).click();
  await expect(toast(page, 'AI settings saved.')).toBeVisible();
  expect((await secrets(page)).aiKeys).toEqual([]);
});

test('the model list says plainly when it cannot be fetched', async ({ page }) => {
  await seedCloudAi(page.request);
  await page.route('**/api/v1/ai/models', (route) => route.abort());
  await page.goto('/settings#ai');
  await openAi(page, 'Claude – mine');
  await section(page).getByRole('button', { name: 'Show the list' }).click();
  await expect(section(page).getByRole('listbox')).toContainText(
    "Couldn't get the list: Can't reach Job Registry. Check that it's still running, then try again.",
  );
});

test('opening another AI with unsaved changes asks first, and keeps them if you say no', async ({ page }) => {
  await seedCloudAi(page.request);
  await page.goto('/settings#ai');
  const ai = section(page);
  await ai.getByLabel('Name').fill('Bonsai 2 renamed');
  const asked: string[] = [];
  page.once('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await ai.getByRole('button', { name: /^Claude – mine/ }).click();
  await expect(ai.getByRole('heading', { name: 'Bonsai 2', exact: true })).toBeVisible();
  await expect(ai.getByLabel('Name')).toHaveValue('Bonsai 2 renamed');
  page.once('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  await ai.getByRole('button', { name: /^Claude – mine/ }).click();
  await expect(ai.getByRole('heading', { name: 'Claude – mine', exact: true })).toBeVisible();
  expect(asked).toEqual(["Your changes to Bonsai 2 aren't saved. Discard them?", "Your changes to Bonsai 2 aren't saved. Discard them?"]);
  expect((await savedSettings(page.request)).ai.name).toBe('Bonsai 2');
});

test('if the key is refused after the AI is saved, it says so, and the AI is not added twice', async ({ page }) => {
  await page.route('**/api/v1/settings/secrets', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'validation', message: 'The key was refused.' } }),
        })
      : route.continue(),
  );
  await page.goto('/settings#ai');
  const ai = section(page);
  await ai.getByRole('button', { name: 'Add an AI' }).click();
  await ai.getByLabel('Provider').selectOption('anthropic');
  await ai.getByLabel('Name').fill('Claude – mine');
  await ai.getByLabel('API key').fill(KEY);
  await ai.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(toast(page, "The AI is saved, but its key isn't: The key was refused.")).toBeVisible();
  await expect(ai.getByRole('heading', { name: 'Claude – mine', exact: true })).toBeVisible();
  await ai.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(toast(page, 'AI settings saved.')).toBeVisible();
  expect((await savedSettings(page.request)).settings.ai.saved.map((one) => one.name)).toEqual(['Bonsai 2', 'Claude – mine']);
});

test('a name another tab has just taken is caught when you save', async ({ page }) => {
  // No live updates in this tab, so it doesn't hear about the other one.
  await page.route('**/api/v1/events', (route) => route.abort());
  await page.goto('/settings#ai');
  const ai = section(page);
  await ai.getByRole('button', { name: 'Add an AI' }).click();
  await ai.getByLabel('Provider').selectOption('anthropic');
  await ai.getByLabel('Name').fill('Claude – mine');
  await seedCloudAi(page.request);
  await ai.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(ai.getByRole('alert')).toHaveText('You already have an AI called Claude – mine. Pick another name.');
  expect((await savedSettings(page.request)).settings.ai.saved.map((one) => one.id)).toEqual(['bonsai-2', 'claude-mine']);
});

test('your own .bat file gets an optional Model file, saved as the model', async ({ page }) => {
  await page.goto('/settings#ai');
  const ai = section(page);
  await expect(ai.getByLabel('Model file')).toHaveCount(0);
  await ai.getByLabel('Program or .bat file').fill('D:\\aitest\\Bonsai-demo\\start_bonsai.bat');
  await ai.getByLabel('Model file').fill('Ternary-Bonsai-2-27B-PQ2_0.gguf');
  await ai.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(toast(page, 'AI settings saved.')).toBeVisible();
  expect((await savedSettings(page.request)).ai.model).toBe('Ternary-Bonsai-2-27B-PQ2_0.gguf');
  await expect(ai.getByRole('listitem').filter({ hasText: 'Bonsai 2' })).toContainText('Bonsai 2 (llama-server) · Ternary-Bonsai-2-27B-PQ2_0.gguf');
});

test('the switcher says which cloud AI has no API key yet, and so does the switch to it', async ({ page }) => {
  await seedCloudAi(page.request, null);
  await page.goto('/');
  await pill(page).click();
  const menu = page.getByRole('menu', { name: 'Switch the AI' });
  const claude = menu.getByRole('menuitemradio', { name: /^Claude – mine/ });
  await expect(claude).toContainText('No API key yet');
  await expect(menu.getByRole('menuitemradio', { name: /^Bonsai 2/ })).not.toContainText('No API key yet');
  await claude.click();
  await expect(toast(page, 'Now using Claude – mine. No API key yet: add one in Settings → AI.')).toBeVisible();

  // Once it has a key (saved anywhere), the menu stops saying so.
  const keyed = await page.request.put('/api/v1/settings/secrets', { headers: { origin: ORIGIN }, data: { aiKeys: { 'claude-mine': KEY } } });
  expect(keyed.ok()).toBe(true);
  await pill(page).click();
  await expect(menu.getByRole('menuitemradio', { name: /^Claude – mine/ })).not.toContainText('No API key yet');
});

test('a model is needed before an AI that uses one can be saved', async ({ page }) => {
  await page.goto('/settings#ai');
  const ai = section(page);
  await ai.getByRole('button', { name: 'Add an AI' }).click();
  await ai.getByLabel('Provider').selectOption('openai');
  await ai.getByLabel('Model', { exact: true }).fill('  ');
  await ai.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(ai.getByRole('alert')).toHaveText('Model: pick one from the list, or type its name.');
  expect((await savedSettings(page.request)).settings.ai.saved.map((one) => one.name)).toEqual(['Bonsai 2']);
  await ai.getByLabel('Model', { exact: true }).fill('gpt-5.5');
  await ai.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(toast(page, 'Added OpenAI.')).toBeVisible();
  expect((await savedSettings(page.request)).settings.ai.saved.find((one) => one.name === 'OpenAI')?.model).toBe('gpt-5.5');
});

test("changing a provider resets each task's own model and extra settings, and says so", async ({ page }) => {
  // Bonsai 2 as an older settings file can have it: a model and extra
  // request fields of its own on some tasks. Claude would refuse top_k.
  const { ai: bonsai } = await savedSettings(page.request);
  const extra = { top_k: 20, chat_template_kwargs: { enable_thinking: true } };
  const tuned = {
    ...bonsai,
    tasks: { ...bonsai.tasks, card: { ...bonsai.tasks.card, extra }, rate: { ...bonsai.tasks.rate, model: 'small' } },
  };
  const patched = await page.request.patch('/api/v1/settings', { headers: { origin: ORIGIN }, data: { ai: { active: 'bonsai-2', saved: [tuned] } } });
  expect(patched.ok()).toBe(true);

  await page.goto('/settings#ai');
  const ai = section(page);
  await ai.getByRole('button', { name: 'Duplicate Bonsai 2' }).click();
  await expect(ai.getByRole('heading', { name: 'Bonsai 2 (copy)', exact: true })).toBeVisible();
  const note = ai.getByText("Each task's own model and extra settings are reset for the new provider.");
  const rateModel = ai.getByLabel('Model for Rating a job');
  await expect(note).toHaveCount(0);
  await expect(rateModel).toHaveValue('small');

  await ai.getByLabel('Provider').selectOption('anthropic');
  await expect(note).toBeVisible();
  await expect(rateModel).toHaveValue('');
  // Back to the provider it was saved with: nothing is reset.
  await ai.getByLabel('Provider').selectOption('llama-server');
  await expect(note).toHaveCount(0);
  await expect(rateModel).toHaveValue('small');

  await ai.getByLabel('Provider').selectOption('anthropic');
  await ai.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(toast(page, 'AI settings saved.')).toBeVisible();
  const { settings } = await savedSettings(page.request);
  const copy = settings.ai.saved.find((one) => one.name === 'Bonsai 2 (copy)')!;
  expect(copy.preset).toBe('anthropic');
  for (const task of Object.values(copy.tasks)) expect(task).toMatchObject({ model: null, extra: {} });
  // The original keeps its own.
  const original = settings.ai.saved.find((one) => one.id === 'bonsai-2')!;
  expect(original.tasks.card.extra).toEqual(extra);
  expect(original.tasks.rate.model).toBe('small');
  await expect(note).toHaveCount(0);
});

