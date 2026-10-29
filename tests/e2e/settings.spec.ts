import { expect, test } from '@playwright/test';
import { reset, seedJob } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test('renames a status and the list shows the new label', async ({ page, request }) => {
  await page.goto('/settings');
  await page.getByLabel('Label for interview_1').fill('First interview');
  await page.getByRole('button', { name: 'Save statuses' }).click();
  await expect(page.getByRole('status')).toContainText('Statuses saved.');
  await seedJob(request, { company: 'Xero', title: 'Analyst', status: 'interview_1' });
  await page.goto('/');
  await expect(page.getByRole('table', { name: 'Jobs' })).toContainText('First interview');
});

test('adds a status and it appears in the status picker', async ({ page, request }) => {
  await page.goto('/settings');
  await page.getByLabel('New status').fill('Phone screen');
  await page.getByRole('button', { name: 'Add status' }).click();
  await page.getByRole('button', { name: 'Save statuses' }).click();
  await expect(page.getByRole('status')).toContainText('Statuses saved.');
  const job = await seedJob(request, { company: 'Canva', title: 'Designer' });
  await page.goto(`/jobs/${job.id}`);
  await expect(page.getByRole('combobox', { name: 'Status' }).locator('option', { hasText: 'Phone screen' })).toHaveCount(1);
});

test('Back up now shows the backup file name', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText(/Backed up to .*jobs-\d{4}-\d{2}-\d{2}-\d{6}\.db/)).toBeVisible();
});

test('Rebuild search index reports what it indexed', async ({ page, request }) => {
  await seedJob(request, { company: 'Xero', title: 'Analyst' });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Rebuild search index' }).click();
  await expect(page.getByText('Search index rebuilt: 1 job, 0 contacts.')).toBeVisible();
});

test("the settings page says so when it can't load", async ({ page }) => {
  await page.route('**/api/v1/settings', (route) => route.abort());
  await page.goto('/settings');
  await expect(page.getByRole('alert')).toContainText("Can't reach Job Registry. Check that it's still running, then try again.");
});

test.describe('AI settings', () => {
  const section = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'AI', exact: true });

  test('choosing Ollama fills in its address, and saving keeps it after a reload', async ({ page }) => {
    await page.goto('/settings#ai');
    const ai = section(page);
    await expect(ai.getByLabel('AI server')).toHaveValue('llama-server');
    await expect(ai.getByLabel('Start and stop llama-server for me')).toBeChecked();
    await ai.getByLabel('AI server').selectOption('ollama');
    await expect(ai.getByLabel('Server address')).toHaveValue('http://127.0.0.1:11434/v1');
    await expect(ai.getByLabel('Start and stop llama-server for me')).toHaveCount(0);
    await ai.getByLabel('Model').fill('qwen3:8b');
    await ai.getByLabel('Stop the AI after this many idle minutes').fill('30');
    await ai.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'AI settings saved.' })).toBeVisible();
    await page.reload();
    await expect(section(page).getByLabel('AI server')).toHaveValue('ollama');
    await expect(section(page).getByLabel('Model')).toHaveValue('qwen3:8b');
    await expect(section(page).getByLabel('Stop the AI after this many idle minutes')).toHaveValue('30');
  });

  test('Test connection shows how the AI answered', async ({ page }) => {
    await page.goto('/settings#ai');
    await section(page).getByRole('button', { name: 'Test connection' }).click();
    await expect(section(page).getByRole('status')).toContainText(/Connected to Bonsai 2 \(llama-server, started by the app\)\. It replied in \d+ ms\./);
  });

  test('Test connection asks for a model when Ollama has none, testing what is on screen', async ({ page }) => {
    await page.goto('/settings#ai');
    await section(page).getByLabel('AI server').selectOption('ollama');
    await section(page).getByRole('button', { name: 'Test connection' }).click();
    await expect(section(page).getByRole('status')).toContainText('Pick a model. The server has: fake-model.');
  });

  test('it says whether match ratings can run', async ({ page }) => {
    await page.goto('/settings#ai');
    await expect(section(page)).toContainText('Ratings use profile/master-profile.md.');
  });

  test('the llama-server program and arguments can be edited, one argument per line', async ({ page }) => {
    await page.goto('/settings#ai');
    const ai = section(page);
    await expect(ai.getByLabel('Program')).toHaveValue('ai/llama.cpp/llama-server.exe');
    await ai.getByLabel('Arguments (one per line)').fill('-m\nai/models/other.gguf\n\n--port\n8080');
    await ai.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'AI settings saved.' })).toBeVisible();
    const settings = (await (await page.request.get('/api/v1/settings')).json()) as { ai: { managed: { args: string[] } } };
    expect(settings.ai.managed.args).toEqual(['-m', 'ai/models/other.gguf', '--port', '8080']);
  });
});
