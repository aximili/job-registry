import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
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

// Settings → Profile's "a newer starter guide is ready" note. After a reset
// the guides are the starters, with no record of which starter you've seen
// (serve.ts), so a guide you change gets the note.
const MY_LINE = '- Sign off with my first name only.';

async function changeGuide(request: APIRequestContext): Promise<string> {
  const starter = ((await (await request.get('/api/v1/profile/cover-letter-guide')).json()) as { text: string }).text;
  const mine = `${starter.trimEnd()}\n${MY_LINE}\n`;
  const res = await request.put('/api/v1/profile/cover-letter-guide', { headers: { origin: ORIGIN }, data: { text: mine } });
  expect(res.ok()).toBe(true);
  return starter;
}

const note = (page: Page) => page.getByRole('region', { name: /^Cover letter guide A newer starter guide is ready/ });

test('a changed guide shows the note, and See what changes opens the diff', async ({ page, request }) => {
  await changeGuide(request);
  await page.goto('/settings');
  await expect(note(page)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Profile, New guide' })).toBeVisible();

  const see = note(page).getByRole('button', { name: 'See what changes' });
  await expect(see).toHaveAttribute('aria-expanded', 'false');
  await see.click();
  await expect(see).toHaveAttribute('aria-expanded', 'true');
  const diff = page.getByRole('group', { name: 'What changes in your cover letter guide' });
  // Your own line goes, told apart by a word as well as a sign and a colour.
  await expect(diff).toContainText(`Removed: ${MY_LINE}`);
  // The unchanged lines before it are folded, and open with one click.
  const fold = diff.getByRole('button', { name: /^Show \d+ unchanged lines$/ });
  await expect(fold).toHaveCount(1);
  await fold.click();
  await expect(diff.getByRole('button', { name: /unchanged line/ })).toHaveCount(0);
  await expect(diff).toContainText('# How I want my cover letters written');
});

test('Use the new guide puts the starter in the editor, says where the old one went, and the note stays gone', async ({ page, request }) => {
  const starter = await changeGuide(request);
  await page.goto('/settings');
  await expect(page.getByRole('textbox', { name: 'Cover letter guide' })).toHaveValue(new RegExp(`${MY_LINE}\\n$`));
  await note(page).getByRole('button', { name: 'Use the new guide' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Now using the new cover letter guide.' })).toHaveText(
    'Now using the new cover letter guide. Your old one is kept in the profile folder, under old-versions.',
  );
  await expect(note(page)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Cover letter guide' })).toHaveValue(starter);
  await expect(page.getByRole('link', { name: 'Profile', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Cover letter guide' })).toHaveValue(starter);
  await expect(note(page)).toHaveCount(0);
});

test('Use the new guide asks first when the guide has unsaved changes', async ({ page, request }) => {
  const starter = await changeGuide(request);
  await page.goto('/settings');
  const box = page.getByRole('textbox', { name: 'Cover letter guide' });
  await box.fill('Typed, not saved yet.');

  let asked = '';
  page.once('dialog', (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await note(page).getByRole('button', { name: 'Use the new guide' }).click();
  expect(asked).toBe("Your cover letter guide has changes you haven't saved. Use the new guide anyway? Your unsaved changes will be lost.");
  await expect(box).toHaveValue('Typed, not saved yet.');
  await expect(note(page)).toBeVisible();

  page.once('dialog', (d) => void d.accept());
  await note(page).getByRole('button', { name: 'Use the new guide' }).click();
  await expect(box).toHaveValue(starter);
  await expect(note(page)).toHaveCount(0);
});

test('Keep mine hides the note, and it stays hidden after a reload', async ({ page, request }) => {
  await changeGuide(request);
  await page.goto('/settings');
  await note(page).getByRole('button', { name: 'Keep mine' }).click();
  await expect(note(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Cover letter guide' })).toHaveValue(new RegExp(`${MY_LINE}\\n$`));
  await expect(note(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Profile', exact: true })).toBeVisible();
});

test('the note works by keyboard alone', async ({ page, request }) => {
  const starter = await changeGuide(request);
  await page.goto('/settings');
  const see = note(page).getByRole('button', { name: 'See what changes' });
  await see.focus();
  await page.keyboard.press('Enter');
  await expect(see).toHaveAttribute('aria-expanded', 'true');
  // Tab to the fold, open it, then on to Use the new guide.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^Show \d+ unchanged lines$/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /unchanged line/ })).toHaveCount(0);
  const use = note(page).getByRole('button', { name: 'Use the new guide' });
  for (let i = 0; i < 5 && !(await use.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(use).toBeFocused();
  await page.keyboard.press('Enter');
  // The note goes, and focus lands on the guide it changed.
  const box = page.getByRole('textbox', { name: 'Cover letter guide' });
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(starter);
});

test('an editor with no unsaved changes takes the file when it changes elsewhere', async ({ page, request }) => {
  await page.goto('/settings');
  const box = page.getByRole('textbox', { name: 'Preferences' });
  await expect(box).toHaveValue('');
  await request.put('/api/v1/profile/preferences', { headers: { origin: ORIGIN }, data: { text: 'Remote only.' } });
  await expect(box).toHaveValue('Remote only.');
});

test("a file that changed since you opened it isn't saved over: the page says so", async ({ page, request }) => {
  await page.goto('/settings');
  const box = page.getByRole('textbox', { name: 'Preferences' });
  await expect(box).toHaveValue('');
  await box.fill('Sydney only.');
  // Another tab saves first: what you typed stays, and the page warns you.
  await request.put('/api/v1/profile/preferences', { headers: { origin: ORIGIN }, data: { text: 'Remote only.' } });
  await expect(page.getByRole('region', { name: 'Profile', exact: true }).getByRole('alert')).toHaveText('This file changed since you opened it. Copy your changes, then reload the page to see the new text.');
  await expect(box).toHaveValue('Sydney only.');
  // Saving anyway is refused, with the server's sentence.
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('region', { name: 'Profile', exact: true }).getByRole('alert')).toHaveText('This file changed since you opened it. Reload the page to see the new text, then make your change again.');
  const res = await request.get('/api/v1/profile/preferences');
  expect(((await res.json()) as { text: string }).text).toBe('Remote only.');
});
