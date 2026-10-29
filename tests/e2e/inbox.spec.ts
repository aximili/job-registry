import { expect, test, type APIRequestContext } from '@playwright/test';
import { ORIGIN, reset, seedJob } from './helpers.ts';

const headers = { origin: ORIGIN };

test.beforeEach(async ({ request }) => {
  await reset(request);
});

async function connectGmail(request: APIRequestContext) {
  const settings = await (await request.get('/api/v1/settings')).json();
  await request.patch('/api/v1/settings', { headers, data: { email: { ...settings.email, enabled: true, address: 'me@gmail.com' } } });
  await request.put('/api/v1/settings/secrets', { headers, data: { emailPassword: 'abcdefghijklmnop' } });
}

async function addMail(request: APIRequestContext, ...messages: { from: string; subject: string; text?: string }[]) {
  await request.post('/__test/mail', { headers, data: { messages } });
}

async function jobStatus(request: APIRequestContext, id: number): Promise<string> {
  return ((await (await request.get(`/api/v1/jobs/${id}`)).json()) as { status: string }).status;
}

const rejection = { from: 'careers@atlassian.com', subject: 'Your application for Senior Engineer', text: 'Unfortunately we will not progress your application.' };

test('a rejection becomes a card, and Confirm marks the job', async ({ page, request }) => {
  await connectGmail(request);
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await addMail(request, rejection);
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Check now' }).click();
  const card = page.getByRole('article');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('heading', { name: 'Rejection' })).toBeVisible();
  await expect(card).toContainText('careers@atlassian.com');
  await expect(card).toContainText('Mark as Rejected?');
  await expect(card.getByRole('link', { name: 'Senior Engineer at Atlassian' })).toBeVisible();
  // Nothing changes until you confirm.
  expect(await jobStatus(request, job.id)).toBe('applied');

  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Marked Senior Engineer as Rejected.')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('Nothing to check. Emails about your jobs show up here.')).toBeVisible();
  expect(await jobStatus(request, job.id)).toBe('rejected');
  await page.goto(`/jobs/${job.id}`);
  const sheet = page.getByRole('region', { name: 'Call sheet' });
  await expect(sheet.getByText(/Email, \d+ \w+ \d{4} \(rejection\) from careers@atlassian\.com/)).toBeVisible();
});

test('Pick another job moves the card to the job you pick', async ({ page, request }) => {
  await connectGmail(request);
  const atlassian = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  const canva = await seedJob(request, { title: 'Designer', company: 'Canva', status: 'interview_1' });
  await addMail(request, rejection);
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Check now' }).click();
  const card = page.getByRole('article');
  const pickButton = card.getByRole('button', { name: 'Pick another job' });
  await expect(pickButton).toHaveAttribute('aria-expanded', 'false');
  await pickButton.click();
  await expect(pickButton).toHaveAttribute('aria-expanded', 'true');
  await card.getByLabel('Find a job').fill('Canva');
  await card.getByRole('button', { name: /Designer at Canva/ }).click();
  await expect(card.getByRole('link', { name: 'Designer at Canva' })).toBeVisible();
  // The focus goes to the status, the next thing to decide.
  await expect(card.getByLabel('New status')).toBeFocused();
  await expect(card.getByLabel('New status')).toHaveValue('rejected');
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Marked Designer as Rejected.')).toBeVisible();
  expect(await jobStatus(request, canva.id)).toBe('rejected');
  expect(await jobStatus(request, atlassian.id)).toBe('applied');
});

test("Don't change the status only adds a note", async ({ page, request }) => {
  await connectGmail(request);
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await addMail(request, rejection);
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Check now' }).click();
  const card = page.getByRole('article');
  await card.getByLabel('New status').selectOption({ label: "Don't change the status" });
  await card.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Added a note to Senior Engineer.')).toBeVisible();
  expect(await jobStatus(request, job.id)).toBe('applied');
});

test('Dismiss leaves the job alone', async ({ page, request }) => {
  await connectGmail(request);
  const job = await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await addMail(request, rejection);
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Check now' }).click();
  await page.getByRole('article').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByText('Dismissed.')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  expect(await jobStatus(request, job.id)).toBe('applied');
});

test('the header count follows the cards', async ({ page, request }) => {
  await connectGmail(request);
  await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await seedJob(request, { title: 'Designer', company: 'Canva', status: 'applied' });
  await addMail(request, rejection, { from: 'talent@canva.com', subject: 'Interview invitation', text: 'We would like to invite you to an interview.' });
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Inbox, 2 to check' })).toBeVisible();
  await page.getByRole('article').first().getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('link', { name: 'Inbox, 1 to check' })).toBeVisible();
  // The focus moves to the next card, so the keyboard carries on from there.
  await expect(page.getByRole('article').first().getByRole('heading')).toBeFocused();
});

test("an email's HTML shows as text and never runs", async ({ page, request }) => {
  await connectGmail(request);
  await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await addMail(request, { ...rejection, subject: '<img src=x onerror="window.__pwned=1">Your application' });
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('article')).toContainText('<img src=x onerror="window.__pwned=1">Your application');
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

test('asks you to connect Gmail first', async ({ page }) => {
  await page.goto('/inbox');
  await expect(page.getByText('Connect Gmail in Settings → Email to see emails about your jobs here.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings → Email' })).toHaveAttribute('href', '/settings#email');
  await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);
});

test('shows why a check failed', async ({ page, request }) => {
  await connectGmail(request);
  await request.post('/__test/mail', { headers, data: { fail: 'Gmail refused the address or app password.' } });
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('alert')).toContainText('Gmail refused the address or app password.');
});

test('Escape or Cancel closes the job search and puts the focus back', async ({ page, request }) => {
  await connectGmail(request);
  await seedJob(request, { title: 'Senior Engineer', company: 'Atlassian', status: 'applied' });
  await addMail(request, rejection);
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Check now' }).click();
  const card = page.getByRole('article');
  const pickButton = card.getByRole('button', { name: 'Pick another job' });
  await pickButton.click();
  await card.getByLabel('Find a job').press('Escape');
  await expect(card.getByLabel('Find a job')).toHaveCount(0);
  await expect(pickButton).toBeFocused();
  await pickButton.click();
  await card.getByRole('button', { name: 'Cancel' }).click();
  await expect(pickButton).toBeFocused();
});

test('a card with no job asks you to pick one', async ({ page, request }) => {
  await connectGmail(request);
  await addMail(request, { from: 'noreply@ats.example', subject: 'Thank you for applying', text: 'We got your application.' });
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Check now' }).click();
  const card = page.getByRole('article');
  await expect(card).toContainText('No job matched');
  await expect(card.getByRole('button', { name: 'Pick a job' })).toBeVisible();
});

test('the end of a check is announced', async ({ page, request }) => {
  await connectGmail(request);
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Last checked' })).toBeVisible();
});
