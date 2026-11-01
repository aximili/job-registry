// The AI on the dashboard: reading a pasted ad, the match rating, the AI
// state pill, and what you see when the AI is down. The server runs a fake AI
// that reads the ad's first lines (see tests/fakes/smart-fake-ai.ts).

import { expect, test, type Page } from '@playwright/test';
import { reset, savedSettings, setAiMode } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

const AD = ['Data Analyst', 'Xero', 'Turn numbers into decisions.', '$90,000 - $110,000 per year', '- SQL', '- Python'].join('\n');

const sheet = (page: Page) => page.getByRole('region', { name: 'Call sheet' });

async function pasteNewJob(page: Page, text = AD) {
  await page.goto('/');
  await page.getByRole('button', { name: /New job/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New job' });
  await dialog.getByLabel('Paste a job link or the ad text').fill(text);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  // Leave the fields empty: the AI fills them in.
  await dialog.getByLabel('Role').fill('');
  await dialog.getByLabel('Company').fill('');
  await dialog.getByRole('button', { name: 'Save job' }).click();
  await expect(page).toHaveURL(/\/jobs\/\d+$/);
}

const aiMode = (page: Page, mode: 'smart' | 'fail' | 'slow' | 'bad') => setAiMode(page.request, mode);

test('a pasted ad is saved at once, then the AI fills in the role, company, salary and requirements', async ({ page }) => {
  await aiMode(page, 'slow');
  await pasteNewJob(page);
  await expect(page.getByRole('status').filter({ hasText: 'Reading the ad…' })).toBeVisible();
  await expect(sheet(page).getByRole('heading', { level: 1 })).toHaveText('Data Analyst', { timeout: 10_000 });
  await expect(sheet(page)).toContainText('Xero');
  await expect(sheet(page)).toContainText('$90,000');
  await expect(sheet(page).getByRole('list').filter({ hasText: 'SQL' })).toContainText('Python');
  await expect(sheet(page)).toContainText('Some details were filled in by the AI. Press E to check them.');
  await expect(page.getByText('Reading the ad…')).toHaveCount(0);
});

test('the match rating shows on the job', async ({ page }) => {
  await pasteNewJob(page);
  const match = page.getByRole('region', { name: 'Match' });
  await expect(match).toContainText('Good match · 72', { timeout: 10_000 });
  await expect(match.getByRole('list', { name: 'Why it fits' })).toContainText('Matches your TypeScript experience');
  await expect(match.getByRole('list', { name: 'Why it might not' })).toContainText('Asks for 5 years of Go');
  await expect(match.getByText('Deal-breakers')).toHaveCount(0);
});

test('when the AI is down, the job says why, and Read again works once it is back', async ({ page }) => {
  await aiMode(page, 'fail');
  await pasteNewJob(page);
  await expect(page.getByText("Couldn't read the ad yet. Can't reach the AI at http://127.0.0.1:8080/v1.")).toBeVisible();
  await expect(page.getByText("It will be read the next time the AI works, or press Read again once it's running.")).toBeVisible();
  await expect(sheet(page).getByRole('heading', { level: 1 })).toHaveText('Untitled role');
  await aiMode(page, 'smart');
  await page.getByRole('button', { name: 'Read again' }).click();
  await expect(sheet(page).getByRole('heading', { level: 1 })).toHaveText('Data Analyst', { timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Read again' })).toHaveCount(0);
});

test('the header pill shows the AI in use and its state, and changes live', async ({ page }) => {
  await page.goto('/');
  const pill = page.getByRole('button', { name: /AI in use$/ });
  await expect(pill).toHaveAccessibleName('Bonsai 2, off, AI in use');
  await pasteNewJob(page);
  await expect(pill).toHaveAccessibleName('Bonsai 2, ready, AI in use', { timeout: 10_000 });
  await aiMode(page, 'fail');
  await pasteNewJob(page, 'Second role\nCanva');
  await expect(pill).toHaveAccessibleName('Bonsai 2, problem, AI in use');
  await expect(pill).toHaveAttribute('title', /Can't reach the AI/);
  await pill.click();
  await expect(page.getByRole('menuitem', { name: 'Manage AIs…' })).toHaveAttribute('href', '/settings#ai');
});

test('an answer that never fits says so, with Read again', async ({ page }) => {
  await aiMode(page, 'bad');
  await pasteNewJob(page);
  await expect(page.getByText("Couldn't read the ad. The AI's answer didn't fit the expected format, even after a second try.")).toBeVisible();
  await aiMode(page, 'smart');
  await page.getByRole('button', { name: 'Read again' }).click();
  await expect(sheet(page).getByRole('heading', { level: 1 })).toHaveText('Data Analyst', { timeout: 10_000 });
});

test('the AI problem is written out in Settings, not only in the pill', async ({ page }) => {
  await aiMode(page, 'fail');
  await pasteNewJob(page);
  await expect(page.getByRole('button', { name: /AI in use$/ })).toHaveAccessibleName('Bonsai 2, problem, AI in use');
  await page.getByRole('button', { name: /AI in use$/ }).click();
  await page.getByRole('menuitem', { name: 'Manage AIs…' }).click();
  const ai = page.getByRole('region', { name: 'AI', exact: true });
  await expect(ai).toContainText("Right now: AI problem. Can't reach the AI at http://127.0.0.1:8080/v1.");
  await expect(page.getByRole('heading', { name: 'AI', exact: true })).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'AI, Problem' })).toBeVisible();
});


test('once the AI is back, Test connection on its form as saved clears the problem, and the waiting ad is read', async ({ page }) => {
  await aiMode(page, 'fail');
  await pasteNewJob(page);
  const pill = page.getByRole('button', { name: /AI in use$/ });
  await expect(pill).toHaveAccessibleName('Bonsai 2, problem, AI in use');
  const jobUrl = page.url();
  await aiMode(page, 'smart');
  await page.goto('/settings#ai');
  const ai = page.getByRole('region', { name: 'AI', exact: true });
  await expect(ai).toContainText('Right now: AI problem.');
  await ai.getByRole('button', { name: 'Test connection' }).click();
  await expect(ai.getByRole('status')).toContainText(/Connected to Bonsai 2 \(llama-server\)\. It replied in \d+ ms\./);
  await expect(pill).toHaveAccessibleName('Bonsai 2, ready, AI in use');
  await expect(ai).toContainText('Right now: AI ready.');
  // The ad that waited for the AI is read now.
  await page.goto(jobUrl);
  await expect(sheet(page).getByRole('heading', { level: 1 })).toContainText('Data Analyst');
});

test('idle minutes are checked only while that box is on screen', async ({ page }) => {
  const before = (await savedSettings(page.request)).ai.idleMinutes;
  await page.goto('/settings#ai');
  const ai = page.getByRole('region', { name: 'AI', exact: true });
  const save = () => ai.getByRole('button', { name: 'Save AI settings' }).click();
  const stop = ai.getByLabel("Stop it when it's idle");
  const minutes = ai.getByLabel('Stop it after this many idle minutes');

  // While the box is there, a bad number stops the save.
  await stop.check();
  await minutes.fill('0');
  await save();
  await expect(ai.getByRole('alert')).toHaveText('Stop it after this many idle minutes: use a whole number, 1 or more.');

  // Untick it, and the hidden box no longer counts: the saved minutes stay.
  await stop.uncheck();
  await save();
  await expect(page.getByRole('status').filter({ hasText: 'AI settings saved.' })).toBeVisible();
  let saved = (await savedSettings(page.request)).ai;
  expect(saved).toMatchObject({ stopWhenIdle: false, idleMinutes: before });

  // The same when you switch to another provider.
  await stop.check();
  await minutes.fill('0');
  await ai.getByLabel('Provider').selectOption('ollama');
  await ai.getByLabel('Model', { exact: true }).fill('qwen3:8b');
  await save();
  await expect(ai.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => (await savedSettings(page.request)).ai.preset).toBe('ollama');
  saved = (await savedSettings(page.request)).ai;
  expect(saved.idleMinutes).toBe(before);
});
