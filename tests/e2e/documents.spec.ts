import { expect, test, type Page } from '@playwright/test';
import { FAKE_RESUME } from '../fakes/smart-fake-ai.ts';
import { putProfileFile, reset, seedDocument, seedJob, setAiMode } from './helpers.ts';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

const text = (page: Page) => page.getByRole('textbox', { name: 'Document text' });
const preview = (page: Page) => page.frameLocator('iframe[title="Preview"]');
const RED = 'rgb(200, 0, 0)';

async function h1Colour(page: Page): Promise<string> {
  const h1 = preview(page).locator('h1');
  await expect(h1).toBeVisible();
  return h1.evaluate((el) => getComputedStyle(el).color);
}

test.describe('the document editor', () => {
  test('generates a resume, saves it as a version, and marks it as sent', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', jdText: 'Senior Engineer\nAtlassian\nTypeScript.' });
    await page.goto(`/jobs/${job.id}/documents/new?kind=resume`);
    await page.getByRole('button', { name: 'Generate resume' }).click();
    await expect(text(page)).toHaveValue(FAKE_RESUME);
    await expect(preview(page).locator('h1')).toHaveText('Sam Taylor');
    await expect(page.getByText('No unknown facts found. Still read it yourself.')).toBeVisible();

    await page.getByRole('button', { name: 'Save version' }).click();
    await expect(page.getByRole('combobox', { name: 'Version' })).toHaveValue(/\d+/);
    await expect(page.getByRole('combobox', { name: 'Version' }).locator('option:checked')).toHaveText(/Version 1 · written by the AI/);
    await expect(page.getByRole('button', { name: 'Save version' })).toBeDisabled();

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Mark as sent' }).click();
    await expect(page.getByText(/^Sent on \d{1,2} \w{3} \d{4}\. Save a copy to change it\.$/)).toBeVisible();
    await expect(text(page)).toHaveAttribute('readonly', '');
    await expect(page.getByRole('combobox', { name: 'Version' }).locator('option:checked')).toHaveText(/Version 1 · sent/);
  });

  test("changing resume.css afterwards doesn't change how either job's sent resume looks (the Phase 4 done criterion)", async ({ page, request }) => {
    const a = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    const b = await seedJob(request, { title: 'Platform Engineer', company: 'Canva' });
    const sentA = await seedDocument(request, a.id, { markdown: '# Sam Taylor\n\nFor Atlassian.', sent: true });
    const sentB = await seedDocument(request, b.id, { markdown: '# Sam Taylor\n\nFor Canva.', sent: true });
    const draft = await seedDocument(request, b.id, { markdown: '# Sam Taylor\n\nA newer draft.' });

    await page.goto('/settings#templates');
    const css = page.getByRole('region', { name: 'Templates' }).getByRole('textbox', { name: 'resume.css' });
    await css.fill(`${await css.inputValue()}\n.document h1 { color: ${RED}; }\n`);
    await page.getByRole('button', { name: 'Save resume.css' }).click();
    await expect(page.getByRole('region', { name: 'Templates' }).getByText('Saved.')).toBeVisible();

    for (const [job, doc] of [
      [a, sentA],
      [b, sentB],
    ] as const) {
      await page.goto(`/jobs/${job.id}/documents/${doc.id}`);
      expect(await h1Colour(page)).not.toBe(RED);
      await page.goto(`/api/v1/documents/${doc.id}/render`);
      expect(await page.locator('h1').evaluate((el) => getComputedStyle(el).color)).not.toBe(RED);
    }
    await page.goto(`/jobs/${b.id}/documents/${draft.id}`);
    expect(await h1Colour(page)).toBe(RED);
  });

  test('flags a fact that is not in your profile, in the list and in the preview', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    await page.goto(`/jobs/${job.id}/documents/new?kind=resume`);
    await text(page).fill('# Sam Taylor\n\n- Grew sales by 40%.\n- Cut build times by 30%.');
    await expect(page.getByText('Not in your profile: 40%')).toBeVisible();
    await expect(preview(page).locator('mark')).toHaveText('40%');
  });

  test('Stop keeps the text written so far, and saves nothing', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    await setAiMode(request, 'slow');
    await page.goto(`/jobs/${job.id}/documents/new?kind=resume`);
    await page.getByRole('button', { name: 'Generate resume' }).click();
    await expect(text(page)).toHaveValue(/Sam/, { timeout: 10_000 });
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText('Stopped. The text so far is still here, not saved.')).toBeVisible();
    const partial = await text(page).inputValue();
    expect(partial.length).toBeGreaterThan(0);
    expect(partial).not.toBe(FAKE_RESUME);
    const saved = await request.get(`/api/v1/jobs/${job.id}/documents`);
    expect(await saved.json()).toEqual([]);
  });

  test('the print view shows the document, with a strict content security policy', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    const doc = await seedDocument(request, job.id, { markdown: '# Sam Taylor\n\nHello <script>window.ran = 1</script>' });
    const res = await page.goto(`/api/v1/documents/${doc.id}/render`);
    expect(res!.headers()['content-security-policy']).toContain("default-src 'none'");
    await expect(page.locator('h1')).toHaveText('Sam Taylor');
    await expect(page.locator('body')).toContainText('<script>window.ran = 1</script>');
    expect(await page.evaluate(() => (window as unknown as { ran?: number }).ran)).toBeUndefined();
    await expect(page).toHaveTitle('Sam Taylor – Resume – Atlassian');
  });

  test("starts from another job's version", async ({ page, request }) => {
    const a = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    const b = await seedJob(request, { title: 'Platform Engineer', company: 'Canva' });
    await seedDocument(request, a.id, { markdown: '# Sam Taylor\n\nThe Atlassian one.' });
    await page.goto(`/jobs/${b.id}/documents/new?kind=resume`);
    await page.getByRole('button', { name: "Start from another job's version" }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Senior Engineer · Atlassian/ }).click();
    await expect(text(page)).toHaveValue('# Sam Taylor\n\nThe Atlassian one.');
    await expect(page.getByRole('combobox', { name: 'Version' }).locator('option:checked')).toHaveText(/Version 1 · copied/);
  });

  test('unsaved text survives a reload and can be restored', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    await page.goto(`/jobs/${job.id}/documents/new?kind=cover_letter`);
    await text(page).fill('Dear Hiring Manager,\n\nHalf a letter');
    await page.reload();
    await expect(page.getByText(/You have unsaved text from/)).toBeVisible();
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(text(page)).toHaveValue('Dear Hiring Manager,\n\nHalf a letter');
  });
});

test('generating without a master profile says how to add one', async ({ page, request }) => {
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
  await putProfileFile(request, 'master-profile', '');
  await page.goto(`/jobs/${job.id}/documents/new?kind=resume`);
  await page.getByRole('button', { name: 'Generate resume' }).click();
  await expect(page.getByRole('alert')).toContainText('Add your master profile first: Settings → Profile.');
});

test.describe('documents on the job page', () => {
  test('lists each version, links to the editor, and the call sheet shows what was sent', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    const v1 = await seedDocument(request, job.id, { markdown: '# Sam Taylor\n\nv1', sent: true });
    await seedDocument(request, job.id, { markdown: '# Sam Taylor\n\nv2' });
    await page.goto(`/jobs/${job.id}`);
    const sheet = page.getByRole('region', { name: 'Call sheet' });
    await expect(sheet.getByText(/Sent: Resume v1 \(\d{1,2} \w{3}\)/)).toBeVisible();

    const panel = page.getByRole('region', { name: 'Documents' });
    await expect(panel.getByRole('link', { name: /Version 2 · edited/ })).toBeVisible();
    await panel.getByRole('link', { name: /Version 1 · sent/ }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}/documents/${v1.id}$`));
    await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveValue('# Sam Taylor\n\nv1');
  });

  test('New cover letter opens an empty editor for that kind', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    await page.goto(`/jobs/${job.id}`);
    await page.getByRole('region', { name: 'Documents' }).getByRole('link', { name: 'New cover letter' }).click();
    await expect(page.getByRole('heading', { name: 'Cover letter', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate cover letter' })).toBeVisible();
  });

  test('attaches a PDF, lists it, and its link downloads it', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    await page.goto(`/jobs/${job.id}`);
    const panel = page.getByRole('region', { name: 'Documents' });
    await panel.getByLabel('Kind of file').selectOption('resume');
    await panel.getByLabel('File to attach').setInputFiles({ name: 'old-cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
    await panel.getByRole('button', { name: 'Attach file' }).click();
    const link = panel.getByRole('link', { name: 'old-cv.pdf' });
    await expect(link).toBeVisible();
    const download = page.waitForEvent('download');
    await link.click();
    expect((await download).suggestedFilename()).toBe('old-cv.pdf');
  });

  test('a file of the wrong type gets a plain message', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    await page.goto(`/jobs/${job.id}`);
    const panel = page.getByRole('region', { name: 'Documents' });
    await panel.getByLabel('File to attach').setInputFiles({ name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
    await panel.getByRole('button', { name: 'Attach file' }).click();
    await expect(panel.getByRole('alert')).toHaveText('Attach a PDF, Word or text file.');
  });
});

test.describe('the editor never loses unsaved text', () => {
  test('Start from another job’s version asks first when there is unsaved text', async ({ page, request }) => {
    const a = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    const b = await seedJob(request, { title: 'Platform Engineer', company: 'Canva' });
    await seedDocument(request, a.id, { markdown: '# Sam Taylor\n\nThe Atlassian one.' });
    await page.goto(`/jobs/${b.id}/documents/new?kind=resume`);
    await text(page).fill('My own words');
    let asked = '';
    page.once('dialog', (d) => {
      asked = d.message();
      void d.dismiss();
    });
    await page.getByRole('button', { name: "Start from another job's version" }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Senior Engineer · Atlassian/ }).click();
    expect(asked).toContain('unsaved text');
    await expect(text(page)).toHaveValue('My own words');
    expect(await (await request.get(`/api/v1/jobs/${b.id}/documents`)).json()).toEqual([]);
  });

  test('Save a copy of a sent version keeps unsaved text from another version', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    const sent = await seedDocument(request, job.id, { markdown: '# Sam Taylor\n\nSent.', sent: true });
    await page.goto(`/jobs/${job.id}/documents/new?kind=resume`);
    await text(page).fill('Half a new resume');
    await page.goto(`/jobs/${job.id}/documents/${sent.id}`);
    await page.getByRole('button', { name: 'Save a copy' }).click();
    await expect(page.getByText(/You have unsaved text from/)).toBeVisible();
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(text(page)).toHaveValue('Half a new resume');
  });

  test('Generate asks first when a draft is waiting to be restored, and keeps it if you say no', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    await page.goto(`/jobs/${job.id}/documents/new?kind=resume`);
    await text(page).fill('Yesterday’s words');
    await page.reload();
    await expect(page.getByText(/You have unsaved text from/)).toBeVisible();
    page.once('dialog', (d) => void d.dismiss());
    await page.getByRole('button', { name: 'Generate resume' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(text(page)).toHaveValue('Yesterday’s words');
  });

  test("a draft that fails at once leaves the editor's text as it was", async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    await setAiMode(request, 'fail');
    await page.goto(`/jobs/${job.id}/documents/new?kind=resume`);
    await text(page).fill('Words I typed');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Generate resume' }).click();
    await expect(page.getByRole('alert')).toContainText("Can't reach the AI");
    await expect(text(page)).toHaveValue('Words I typed');
  });
});

test.describe('the editor, as you use it', () => {
  test('the preview follows while the draft is written', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    await setAiMode(request, 'slow');
    await page.goto(`/jobs/${job.id}/documents/new?kind=resume`);
    await page.getByRole('button', { name: 'Generate resume' }).click();
    await expect(preview(page).locator('h1')).toHaveText('Sam Taylor', { timeout: 4000 });
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  });

  test('choosing another version moves only when you press Open', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    const v1 = await seedDocument(request, job.id, { markdown: '# Sam Taylor\n\nv1' });
    const v2 = await seedDocument(request, job.id, { markdown: '# Sam Taylor\n\nv2' });
    await page.goto(`/jobs/${job.id}/documents/${v2.id}`);
    await page.getByRole('combobox', { name: 'Version' }).selectOption(String(v1.id));
    await expect(page).toHaveURL(new RegExp(`/documents/${v2.id}$`));
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page).toHaveURL(new RegExp(`/documents/${v1.id}$`));
  });

  test('saving and sending say what happened, and the heading takes the focus', async ({ page, request }) => {
    const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian' });
    await page.goto(`/jobs/${job.id}/documents/new?kind=resume`);
    await text(page).fill('# Sam Taylor');
    await page.getByRole('button', { name: 'Save version' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved as version 1.' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(page.getByText('Print / PDF opens the page in a new tab. Press Ctrl+P there')).toBeVisible();
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Mark as sent' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Version 1 is marked as sent.' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  });
});
