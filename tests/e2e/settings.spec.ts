import { expect, test, type Page } from '@playwright/test';
import { ORIGIN, reset, seedJob } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test('renames a status and the list shows the new label', async ({ page, request }) => {
  await page.goto('/settings#statuses');
  await page.getByLabel('Label for interview_1').fill('First interview');
  await page.getByRole('button', { name: 'Save statuses' }).click();
  await expect(page.getByRole('status')).toContainText('Statuses saved.');
  await seedJob(request, { company: 'Xero', title: 'Analyst', status: 'interview_1' });
  await page.goto('/');
  await expect(page.getByRole('table', { name: 'Jobs' })).toContainText('First interview');
});

test('adds a status and it appears in the status picker', async ({ page, request }) => {
  await page.goto('/settings#statuses');
  await page.getByLabel('New status').fill('Phone screen');
  await page.getByRole('button', { name: 'Add status' }).click();
  await page.getByRole('button', { name: 'Save statuses' }).click();
  await expect(page.getByRole('status')).toContainText('Statuses saved.');
  const job = await seedJob(request, { company: 'Canva', title: 'Designer' });
  await page.goto(`/jobs/${job.id}`);
  await expect(page.getByRole('combobox', { name: 'Status' }).locator('option', { hasText: 'Phone screen' })).toHaveCount(1);
});

test('Back up now shows the backup file name', async ({ page }) => {
  await page.goto('/settings#data');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText(/Backed up to .*jobs-\d{4}-\d{2}-\d{2}-\d{6}\.db/)).toBeVisible();
});

test('Rebuild search index reports what it indexed', async ({ page, request }) => {
  await seedJob(request, { company: 'Xero', title: 'Analyst' });
  await page.goto('/settings#data');
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
    await expect(ai.getByLabel("Start it for me when it isn't running")).toBeChecked();
    // Exact: each task below has its own "Model for …".
    await expect(ai.getByLabel('Model', { exact: true })).toHaveCount(0);
    await ai.getByLabel('AI server').selectOption('ollama');
    await expect(ai.getByLabel('Server address')).toHaveValue('http://127.0.0.1:11434/v1');
    await expect(ai.getByLabel("Start it for me when it isn't running")).toHaveCount(0);
    // The app never stops Ollama, so there's no idle stop to set.
    await expect(ai.getByLabel("Stop it when it's idle")).toHaveCount(0);
    await expect(ai).toContainText('Start this server yourself.');
    await ai.getByLabel('Model', { exact: true }).fill('qwen3:8b');
    await ai.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'AI settings saved.' })).toBeVisible();
    await page.reload();
    await expect(section(page).getByLabel('AI server')).toHaveValue('ollama');
    await expect(section(page).getByLabel('Model', { exact: true })).toHaveValue('qwen3:8b');
  });

  test('Test connection shows how the AI answered', async ({ page }) => {
    await page.goto('/settings#ai');
    await section(page).getByRole('button', { name: 'Test connection' }).click();
    await expect(section(page).getByRole('status')).toContainText(/Connected to Bonsai 2 \(llama-server\)\. It replied in \d+ ms\./);
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

  test('the llama-server program and options can be edited, one option per line', async ({ page }) => {
    await page.goto('/settings#ai');
    const ai = section(page);
    await expect(ai.getByLabel('Program or .bat file')).toHaveValue('ai/llama.cpp/llama-server.exe');
    await ai.getByLabel('Options (one per line)').fill('-m\nai/models/other.gguf\n\n--port\n8080');
    await ai.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'AI settings saved.' })).toBeVisible();
    const settings = (await (await page.request.get('/api/v1/settings')).json()) as { ai: { managed: { args: string[] } } };
    expect(settings.ai.managed.args).toEqual(['-m', 'ai/models/other.gguf', '--port', '8080']);
  });

  test('stopping the AI when idle is off until you tick it, then you pick the minutes', async ({ page }) => {
    await page.goto('/settings#ai');
    const ai = section(page);
    const stop = ai.getByLabel("Stop it when it's idle");
    await expect(stop).not.toBeChecked();
    await expect(ai.getByLabel('Stop it after this many idle minutes')).toHaveCount(0);
    await expect(ai).toContainText('It keeps running until Job Registry stops.');
    await stop.check();
    await ai.getByLabel('Stop it after this many idle minutes').fill('30');
    await ai.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'AI settings saved.' })).toBeVisible();
    const saved = (await (await page.request.get('/api/v1/settings')).json()) as { ai: { stopWhenIdle: boolean; idleMinutes: number } };
    expect(saved.ai).toMatchObject({ stopWhenIdle: true, idleMinutes: 30 });
    await page.reload();
    await expect(section(page).getByLabel("Stop it when it's idle")).toBeChecked();
    await expect(section(page).getByLabel('Stop it after this many idle minutes')).toHaveValue('30');
  });

  test('your own start_bonsai.bat: no options or idle time, and it says the app opens it in its own window', async ({ page }) => {
    await page.goto('/settings#ai');
    const ai = section(page);
    await ai.getByLabel('Program or .bat file').fill('D:\\aitest\\Bonsai-demo\\start_bonsai.bat');
    await expect(ai.getByLabel('Options (one per line)')).toHaveCount(0);
    await expect(ai.getByLabel("Stop it when it's idle")).toHaveCount(0);
    await expect(ai).toContainText('The app opens this file in its own window');
    await expect(ai).toContainText('The app never closes that window');
    await ai.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'AI settings saved.' })).toBeVisible();
    const settings = (await (await page.request.get('/api/v1/settings')).json()) as { ai: { managed: { exe: string; args: string[] } } };
    expect(settings.ai.managed.exe).toBe('D:\\aitest\\Bonsai-demo\\start_bonsai.bat');
    // The options stay saved, for when you go back to llama-server.exe.
    expect(settings.ai.managed.args).toContain('-ngl');
  });

  test.describe('how the AI works on each task', () => {
    type Task = { model: string | null; temperature: number; maxTokens: number; thinking: boolean; thinkingEffort: string; extra: object };
    type Saved = { ai: { tasks: Record<string, Task> } };
    const task = (page: Page, name: string) => section(page).getByRole('group', { name, exact: true });
    const saved = async (page: Page) => (await (await page.request.get('/api/v1/settings')).json()) as Saved;
    const save = (page: Page) => section(page).getByRole('button', { name: 'Save AI settings' }).click();

    test('each task has its own row, saved with the rest, and its extra fields stay as they are', async ({ page }) => {
      // Extra request fields, as you might add them to settings.json by hand.
      const extra = { top_k: 20, chat_template_kwargs: { enable_thinking: true } };
      const { ai } = await saved(page);
      ai.tasks.rate = { ...ai.tasks.rate!, extra };
      expect((await page.request.patch('/api/v1/settings', { headers: { origin: ORIGIN }, data: { ai } })).ok()).toBe(true);

      await page.goto('/settings#ai');
      await expect(section(page).getByRole('heading', { name: 'How the AI works on each task' })).toBeVisible();
      const card = task(page, 'Quick marks on search lists');
      await expect(card.getByLabel('Thinking').locator('option:checked')).toHaveText('Off');
      await expect(card.getByLabel('Longest answer')).toHaveValue('512');

      const rate = task(page, 'Rating a job');
      await rate.getByLabel('Thinking').selectOption({ label: 'Low' });
      await rate.getByLabel('Longest answer').fill('1500');
      await save(page);
      await expect(page.getByRole('status').filter({ hasText: 'AI settings saved.' })).toBeVisible();

      await page.reload();
      await expect(task(page, 'Rating a job').getByLabel('Thinking').locator('option:checked')).toHaveText('Low');
      await expect(task(page, 'Rating a job').getByLabel('Longest answer')).toHaveValue('1500');
      expect((await saved(page)).ai.tasks.rate).toEqual({
        model: null,
        temperature: 0.3,
        maxTokens: 1500,
        thinking: true,
        thinkingEffort: 'low',
        extra,
      });
    });

    test('No limit leaves the thinking and the answer to the AI, so Longest answer is off', async ({ page }) => {
      await page.goto('/settings#ai');
      const write = task(page, 'Writing resumes and cover letters');
      await expect(write.getByLabel('Thinking').locator('option:checked')).toHaveText('No limit');
      await expect(write.getByLabel('Longest answer')).toBeDisabled();

      const rate = task(page, 'Rating a job');
      await expect(rate.getByLabel('Longest answer')).toBeEnabled();
      await rate.getByLabel('Thinking').selectOption({ label: 'No limit' });
      await expect(rate.getByLabel('Longest answer')).toBeDisabled();
      await save(page);
      await expect(page.getByRole('status').filter({ hasText: 'AI settings saved.' })).toBeVisible();
      expect((await saved(page)).ai.tasks.rate).toMatchObject({ thinking: true, thinkingEffort: 'max', maxTokens: 2048 });

      await rate.getByLabel('Thinking').selectOption({ label: 'High' });
      await expect(rate.getByLabel('Longest answer')).toBeEnabled();
      await save(page);
      await expect.poll(async () => (await saved(page)).ai.tasks.rate.thinkingEffort).toBe('high');
    });

    test('an empty Model means the same model as above', async ({ page }) => {
      await page.goto('/settings#ai');
      const model = task(page, 'Writing resumes and cover letters').getByLabel('Model');
      await expect(model).toHaveValue('');
      await expect(model).toHaveAttribute('placeholder', 'Same as above');
      await model.fill('qwen3:32b');
      await save(page);
      // The toast comes once the form has reloaded what was saved.
      await expect(page.getByRole('status').filter({ hasText: 'AI settings saved.' })).toBeVisible();
      expect((await saved(page)).ai.tasks.write.model).toBe('qwen3:32b');
      await model.fill('');
      await save(page);
      await expect.poll(async () => (await saved(page)).ai.tasks.write.model).toBeNull();
    });

    test('a Longest answer that is not a number, or under 16, says so and saves nothing', async ({ page }) => {
      for (const typed of ['', 'abc', '10']) {
        await page.goto('/settings#ai');
        const longest = task(page, 'Rating a job').getByLabel('Longest answer');
        await longest.fill('');
        // Typed key by key: a number box won't take letters any other way.
        if (typed) await longest.pressSequentially(typed);
        await save(page);
        await expect(section(page).getByRole('alert')).toHaveText('Rating a job: the longest answer must be a whole number, 16 or more.');
        await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'AI, Not saved' })).toBeVisible();
      }
      expect((await saved(page)).ai.tasks.rate.maxTokens).toBe(2048);
    });
  });
});

test.describe('the Settings menu', () => {
  const menu = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Settings sections' });

  test('shows one section at a time, each at its own address, and Back returns', async ({ page }) => {
    await page.goto('/settings');
    await expect(menu(page).getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: 'Profile' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'AI', exact: true })).toHaveCount(0);

    await menu(page).getByRole('link', { name: /^AI/ }).click();
    await expect(page).toHaveURL(/\/settings#ai$/);
    await expect(page.getByRole('region', { name: 'AI', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Profile' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'AI', exact: true })).toBeFocused();

    await page.goBack();
    await expect(page.getByRole('region', { name: 'Profile' })).toBeVisible();
    await page.goto('/settings#data');
    await expect(page.getByRole('button', { name: 'Back up now' })).toBeVisible();
    await expect(menu(page).getByRole('link', { name: 'Your data' })).toHaveAttribute('aria-current', 'page');
  });

  test('moving between sections keeps what you typed, and the menu says what is not saved', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('textbox', { name: 'Master profile' }).fill('# Jo Citizen\nPasted, not saved yet.');
    let asked = false;
    page.on('dialog', (d) => {
      asked = true;
      void d.dismiss();
    });
    await menu(page).getByRole('link', { name: /^Email/ }).click();
    await expect(page.getByRole('region', { name: 'Email' })).toBeVisible();
    expect(asked).toBe(false);
    await expect(menu(page).getByRole('link', { name: 'Profile, Not saved' })).toBeVisible();
    await expect(menu(page).getByRole('link', { name: 'Email, Off' })).toBeVisible();

    await menu(page).getByRole('link', { name: /^Profile/ }).click();
    await expect(page.getByRole('textbox', { name: 'Master profile' })).toHaveValue('# Jo Citizen\nPasted, not saved yet.');
    await page.getByRole('button', { name: 'Save master profile' }).click();
    await expect(menu(page).getByRole('link', { name: 'Profile', exact: true })).toBeVisible();
  });
});

test.describe('Display', () => {
  const paper = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

  test('Light or Dark wins over the computer, stays after a reload, and Match this computer undoes it', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/settings#display');
    await expect(page.getByRole('radio', { name: 'Match this computer (now dark)' })).toBeChecked();
    const dark = await paper(page);

    await page.getByRole('radio', { name: 'Light' }).check();
    await expect.poll(() => paper(page)).not.toBe(dark);
    const light = await paper(page);

    await page.reload();
    await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(await paper(page)).toBe(light);

    await page.getByRole('radio', { name: /^Match this computer/ }).check();
    await expect.poll(() => paper(page)).toBe(dark);
    // The computer changes its mind: the page follows, and so does the label.
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => paper(page)).toBe(light);
    await expect(page.getByRole('radio', { name: 'Match this computer (now light)' })).toBeChecked();
  });
});
