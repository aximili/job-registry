// The AI on the dashboard: reading a pasted ad, the match rating, the AI
// state pill, and what you see when the AI is down. The server runs a fake AI
// that reads the ad's first lines (see tests/fakes/smart-fake-ai.ts).

import { expect, test, type Page } from '@playwright/test';
import { reset, setAiMode } from './helpers.ts';

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

test('the header pill shows the AI state and changes live', async ({ page }) => {
  await page.goto('/');
  const pill = page.getByRole('link', { name: /^AI / });
  await expect(pill).toHaveText('AI off');
  await pasteNewJob(page);
  await expect(pill).toHaveText('AI ready', { timeout: 10_000 });
  await aiMode(page, 'fail');
  await pasteNewJob(page, 'Second role\nCanva');
  await expect(pill).toHaveText('AI problem');
  await expect(pill).toHaveAttribute('title', /Can't reach the AI/);
  await expect(pill).toHaveAttribute('href', '/settings#ai');
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
  await expect(page.getByRole('link', { name: /^AI / })).toHaveText('AI problem');
  await page.getByRole('link', { name: /^AI / }).click();
  const ai = page.getByRole('region', { name: 'AI', exact: true });
  await expect(ai).toContainText("Right now: AI problem. Can't reach the AI at http://127.0.0.1:8080/v1.");
  await expect(page.getByRole('heading', { name: 'AI', exact: true })).toBeFocused();
});

