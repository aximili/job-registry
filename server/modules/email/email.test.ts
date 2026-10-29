import { Writable } from 'node:stream';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type EmailClassification } from '../../../shared/contracts/index.ts';
import { AiRefusedError, AiUnavailableError } from '../../core/errors.ts';
import { FakeAiProvider, defaultReply } from '../../../tests/fakes/fake-ai-provider.ts';
import { FakeMailSource } from '../../../tests/fakes/fake-mail-source.ts';
import { readEmailLikeAPerson } from '../../../tests/fakes/smart-fake-ai.ts';
import { pastedCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';
import type { ChatRequest } from '../ai/index.ts';

const NOW = new Date('2026-10-29T00:00:00Z');
const isClassify = (req: ChatRequest) => req.jsonSchema?.name === 'email_classification';
// Reads the email by its words, and picks the first job it was shown.
const skim = (req: ChatRequest) => JSON.stringify(readEmailLikeAPerson(req.messages[0]!.content, req.messages[1]!.content));

let app: TestApp | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await app?.cleanup();
  app = undefined;
});

async function setup(o: { email?: Partial<typeof DEFAULT_SETTINGS.email>; password?: string | null; ai?: FakeAiProvider; logs?: string[] } = {}) {
  const mail = new FakeMailSource();
  const ai = o.ai ?? new FakeAiProvider((req) => (isClassify(req) ? skim(req) : defaultReply(req)));
  const logger = o.logs
    ? pino({ level: 'debug' }, new Writable({ write: (chunk, _enc, done) => (o.logs!.push(String(chunk)), done()) }))
    : undefined;
  app = await createTestApp({
    now: () => NOW,
    settings: { email: { ...DEFAULT_SETTINGS.email, enabled: true, address: 'me@gmail.com', ...o.email } },
    secrets: { emailPassword: o.password === undefined ? 'abcdabcdabcdabcd' : o.password },
    fakes: { ai, mail },
    logger,
  });
  const { jobs, contacts, email } = app.services;
  const save = (title: string, company: string, status = 'applied') => {
    const res = jobs.save({ capture: pastedCapture(`${title} at ${company}.`), fields: { title, company }, status });
    if (res.result !== 'created') throw new Error('not created');
    return res.job;
  };
  const atlassian = save('Senior Engineer', 'Atlassian');
  const canva = save('Designer', 'Canva');
  const recruiter = contacts.create({ name: 'Talent Team', email: 'careers@atlassian.com' });
  contacts.linkToJob(atlassian.id, { contactId: recruiter.id, relation: 'recruiter' });
  return { app, mail, ai, email, jobs, notes: app.services.notes, atlassian, canva };
}

const rejection = { from: 'careers@atlassian.com', subject: 'Your application for Senior Engineer', text: 'Unfortunately we will not progress your application.' };

describe('email: checking', () => {
  it('a check never changes a job', async () => {
    const { mail, email, jobs, notes, atlassian } = await setup();
    mail.add(rejection);
    const status = await email.checkNow();
    expect(status).toMatchObject({ lastError: null, lastAdded: 1, pending: 1, checking: false });
    const [card] = email.listSuggestions();
    expect(card).toMatchObject({ jobId: atlassian.id, event: 'rejected', suggestedStatus: 'rejected', state: 'pending' });
    expect(card!.job?.title).toBe('Senior Engineer');
    expect(jobs.get(atlassian.id).status).toBe('applied');
    expect(jobs.listHistory(atlassian.id).map((h) => h.toStatus)).toEqual(['applied']);
    expect(notes.listForJob(atlassian.id)).toEqual([]);
  });

  it('stores summaries only, and logs no email text', async () => {
    const logs: string[] = [];
    let n = 0;
    const ai = new FakeAiProvider((req) => {
      if (!isClassify(req)) return defaultReply(req);
      n++;
      if (n === 2) return JSON.stringify({ event: 'other', jobId: null, company: null, role: null, confidence: 0.2, summary: 'A newsletter.' } satisfies EmailClassification);
      return skim(req);
    });
    const { app, mail, email } = await setup({ ai, logs });
    mail.add({ ...rejection, text: 'Unfortunately we will not progress. SECRET-BODY-123' });
    mail.add({ from: 'noreply@ats.example', subject: 'Thank you for applying', text: 'Marketing SECRET-BODY-456' });
    await email.checkNow();
    const everything = JSON.stringify([
      app.db.prepare('SELECT * FROM email_suggestions').all(),
      app.db.prepare('SELECT * FROM email_state').all(),
    ]);
    expect(everything).not.toContain('SECRET-BODY');
    // The check is logged, with counts only.
    expect(logs.join('')).toMatch(/"read":2,"added":1,"ms":\d+.*Checked email/);
    expect(logs.join('')).not.toContain('SECRET-BODY');
    const ignored = app.db.prepare("SELECT * FROM email_suggestions WHERE state = 'ignored'").all();
    expect(ignored).toEqual([
      expect.objectContaining({ message_id: '<2@fake.example>', from_addr: null, subject: null, summary: null, event: null, job_id: null }),
    ]);
  });

  it('the AI going away mid-check keeps the rest for next time', async () => {
    let n = 0;
    let down = true;
    const ai = new FakeAiProvider((req) => {
      if (!isClassify(req)) return defaultReply(req);
      n++;
      if (down && n === 2) return new AiUnavailableError("Can't reach the AI at http://fake/v1.");
      return skim(req);
    });
    const { app, mail, email } = await setup({ ai });
    mail.add({ ...rejection, subject: 'First: your application' });
    mail.add({ ...rejection, subject: 'Second: your application' });
    mail.add({ ...rejection, subject: 'Third: your application' });
    const first = await email.checkNow();
    expect(first.lastError).toBe("Waiting for the AI: Can't reach the AI at http://fake/v1.");
    expect(email.listSuggestions()).toHaveLength(1);
    const cursor = app.db.prepare("SELECT value FROM email_state WHERE key = 'cursor'").get() as { value: string };
    expect(JSON.parse(cursor.value)).toEqual({ address: 'me@gmail.com', mailbox: 'INBOX', uidValidity: '1', lastUid: 1 });

    down = false;
    const second = await email.checkNow();
    expect(second.lastError).toBeNull();
    expect(email.listSuggestions().map((s) => s.subject).sort()).toEqual([
      'First: your application',
      'Second: your application',
      'Third: your application',
    ]);
    const asked = ai.callsFor('email_classification').map((c) => c.messages[1]!.content);
    expect(asked.filter((t) => t.includes('First: your application'))).toHaveLength(1);
  });

  it('an AI server that refuses every email stops the check, and keeps the mail for later', async () => {
    let refuse = true;
    const ai = new FakeAiProvider((req) => {
      if (!isClassify(req)) return defaultReply(req);
      return refuse ? new AiRefusedError('The AI server at http://fake/v1 refused the request: 404 model not found.') : skim(req);
    });
    const { mail, email } = await setup({ ai });
    mail.add({ ...rejection, subject: 'First: your application' });
    mail.add({ ...rejection, subject: 'Second: your application' });
    const first = await email.checkNow();
    expect(email.listSuggestions()).toEqual([]);
    expect(first.lastError).toBe('Waiting for the AI: The AI server at http://fake/v1 refused the request: 404 model not found.');
    expect(first.lastAdded).toBe(0);

    refuse = false;
    await email.checkNow();
    expect(mail.cursors.at(-1)).toBeNull();
    expect(email.listSuggestions().map((s) => s.event)).toEqual(['rejected', 'rejected']);
  });

  it('an email the AI refuses on its own still shows, once a later email is read', async () => {
    const ai = new FakeAiProvider((req) => {
      if (!isClassify(req)) return defaultReply(req);
      return req.messages[1]!.content.includes('Too long') ? new AiRefusedError('The AI server refused the request: 400 context too long.') : skim(req);
    });
    const { mail, email } = await setup({ ai });
    mail.add({ ...rejection, subject: 'Too long: your application' });
    mail.add({ ...rejection, subject: 'Fine: your application' });
    const status = await email.checkNow();
    expect(status.lastError).toBeNull();
    expect(status.lastAdded).toBe(2);
    const cards = email.listSuggestions();
    expect(cards.map((c) => [c.subject, c.summary])).toEqual(
      expect.arrayContaining([
        ['Too long: your application', "The AI couldn't read this email. Open Gmail to read it."],
        ['Fine: your application', 'About: Fine: your application'],
      ]),
    );
  });

  it('an email refused on three checks in a row still shows, so it never blocks the inbox', async () => {
    const ai = new FakeAiProvider((req) =>
      isClassify(req) ? new AiRefusedError('The AI server refused the request: 400 context too long.') : defaultReply(req),
    );
    const { mail, email } = await setup({ ai });
    mail.add(rejection);
    expect((await email.checkNow()).lastError).toMatch(/^Waiting for the AI:/);
    expect((await email.checkNow()).lastError).toMatch(/^Waiting for the AI:/);
    const third = await email.checkNow();
    expect(third.lastError).toBeNull();
    expect(email.listSuggestions()).toEqual([expect.objectContaining({ summary: "The AI couldn't read this email. Open Gmail to read it." })]);
    await email.checkNow();
    expect(email.listSuggestions()).toHaveLength(1);
  });

  it("confirming an email the AI couldn't read notes its subject, not the AI's trouble", async () => {
    const ai = new FakeAiProvider((req) => (isClassify(req) ? 'I cannot say.' : defaultReply(req)));
    const { mail, email, notes, atlassian } = await setup({ ai });
    mail.add(rejection);
    await email.checkNow();
    email.confirm(email.listSuggestions()[0]!.id, { status: null });
    const [note] = notes.listForJob(atlassian.id);
    expect(note!.body).toMatch(/^Email, \d+ Oct 2026 from careers@atlassian\.com: Your application for Senior Engineer$/);
  });

  it('a bad AI answer still shows the email', async () => {
    const ai = new FakeAiProvider((req) => (isClassify(req) ? 'I cannot say.' : defaultReply(req)));
    const { mail, email, atlassian } = await setup({ ai });
    mail.add(rejection);
    await email.checkNow();
    expect(email.listSuggestions()).toEqual([
      expect.objectContaining({
        event: 'other',
        jobId: atlassian.id,
        suggestedStatus: null,
        confidence: 0,
        summary: "The AI couldn't read this email. Open Gmail to read it.",
      }),
    ]);
  });

  it('a new UIDVALIDITY makes no duplicates', async () => {
    const { mail, email, ai } = await setup();
    mail.add(rejection);
    await email.checkNow();
    const asked = ai.callsFor('email_classification').length;
    mail.uidValidity = '2';
    await email.checkNow();
    expect(email.listSuggestions()).toHaveLength(1);
    expect(ai.callsFor('email_classification')).toHaveLength(asked);
  });

  it('takes mail in rounds until it has read it all', async () => {
    const { mail, email } = await setup({ email: { maxPerCheck: 2 } });
    for (let i = 1; i <= 5; i++) mail.add({ ...rejection, subject: `Email ${i}: your application` });
    const status = await email.checkNow();
    expect(status.lastAdded).toBe(5);
    expect(email.listSuggestions()).toHaveLength(5);
    expect(mail.fetches).toBe(3);
  });

  it('skips email the first filter keeps out, without asking the AI', async () => {
    const { mail, email, ai } = await setup();
    mail.add({ from: 'news@example.com', subject: 'Weekly news', text: 'Nothing about jobs.' });
    await email.checkNow();
    expect(ai.callsFor('email_classification')).toHaveLength(0);
    expect(email.status().lastAdded).toBe(0);
  });

  it('a mail error is kept and shown, and the next good check clears it', async () => {
    const { app, mail, email } = await setup();
    const checked: unknown[] = [];
    app.bus.on('email.checked', (p) => checked.push(p));
    mail.fail = new Error('Gmail refused the address or app password.');
    const failed = await email.checkNow();
    expect(failed.lastError).toBe('Gmail refused the address or app password.');
    expect(checked).toEqual([{ ok: false, error: 'Gmail refused the address or app password.' }]);
    mail.fail = null;
    expect((await email.checkNow()).lastError).toBeNull();
    expect(email.status().lastCheckAt).toBe(NOW.toISOString());
  });

  it.each([
    ['email is off', { email: { enabled: false } }],
    ['there is no address', { email: { address: '' } }],
    ['there is no app password', { password: null }],
  ])('refuses to check when %s', async (_name, o) => {
    const { email, mail } = await setup(o);
    await expect(email.checkNow()).rejects.toThrow('Connect Gmail first: Settings → Email.');
    expect(mail.fetches).toBe(0);
  });

  it('two checks at once share one', async () => {
    const { mail, email } = await setup();
    mail.delayMs = 30;
    await Promise.all([email.checkNow(), email.checkNow()]);
    expect(mail.fetches).toBe(1);
  });

  it('tells the dashboard when new suggestions arrive', async () => {
    const { app, mail, email } = await setup();
    const added: unknown[] = [];
    app.bus.on('email.suggestionsAdded', (p) => added.push(p));
    mail.add(rejection);
    await email.checkNow();
    expect(added).toEqual([{ count: 1 }]);
  });
});

describe('email: the cursor belongs to one mailbox', () => {
  it('a new Gmail address or mailbox starts again by date', async () => {
    const { app, mail, email } = await setup();
    mail.add(rejection);
    await email.checkNow();
    await email.checkNow();
    expect(mail.cursors.at(-1)).toEqual({ uidValidity: '1', lastUid: 1 });

    const settings = app.services.settings;
    settings.update({ email: { ...settings.get().email, address: 'other@gmail.com' } });
    await email.checkNow();
    expect(mail.cursors.at(-1)).toBeNull();

    settings.update({ email: { ...settings.get().email, mailbox: '[Gmail]/All Mail' } });
    await email.checkNow();
    expect(mail.cursors.at(-1)).toBeNull();
    await email.checkNow();
    expect(mail.cursors.at(-1)).toEqual({ uidValidity: '1', lastUid: 1 });
  });
});

describe('email: confirm and dismiss', () => {
  async function withCard() {
    const s = await setup();
    s.mail.add(rejection);
    await s.email.checkNow();
    return { ...s, card: s.email.listSuggestions()[0]! };
  }

  it('confirm changes the status with source email and adds one note', async () => {
    const { email, jobs, notes, atlassian, card } = await withCard();
    const done = email.confirm(card.id, {});
    expect(done).toMatchObject({ state: 'confirmed', appliedStatus: 'rejected', jobId: atlassian.id });
    expect(jobs.get(atlassian.id).status).toBe('rejected');
    expect(jobs.listHistory(atlassian.id)).toContainEqual(expect.objectContaining({ toStatus: 'rejected', source: 'email' }));
    const list = notes.listForJob(atlassian.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.body).toMatch(/^Email, \d+ Oct 2026 \(rejection\) from careers@atlassian\.com: About: Your application/);
    expect(email.listSuggestions()).toEqual([]);
    expect(() => email.confirm(card.id, {})).toThrow('This email was already handled.');
  });

  it('confirm with another job works out the suggestion again for that job', async () => {
    const { email, jobs, canva, card } = await withCard();
    jobs.changeStatus(canva.id, 'interview_1', 'manual');
    email.confirm(card.id, { jobId: canva.id });
    expect(jobs.get(canva.id).status).toBe('rejected');
  });

  it('confirm with status null only adds the note', async () => {
    const { email, jobs, notes, atlassian, card } = await withCard();
    expect(email.confirm(card.id, { status: null })).toMatchObject({ state: 'confirmed', appliedStatus: null });
    expect(jobs.get(atlassian.id).status).toBe('applied');
    expect(notes.listForJob(atlassian.id)).toHaveLength(1);
  });

  it('confirm with a status you chose uses it', async () => {
    const { email, jobs, atlassian, card } = await withCard();
    email.confirm(card.id, { status: 'withdrawn' });
    expect(jobs.get(atlassian.id).status).toBe('withdrawn');
  });

  it('confirm needs a job when the email matched none', async () => {
    const ai = new FakeAiProvider((req) =>
      isClassify(req) ? JSON.stringify({ event: 'rejected', jobId: null, company: 'Globex', role: null, confidence: 0.9, summary: 'No.' }) : defaultReply(req),
    );
    const { mail, email, notes, canva } = await setup({ ai });
    mail.add({ from: 'noreply@ats.example', subject: 'Your application was unsuccessful', text: 'Sorry.' });
    await email.checkNow();
    const [card] = email.listSuggestions();
    expect(card).toMatchObject({ jobId: null, job: null, suggestedStatus: null, company: 'Globex' });
    expect(() => email.confirm(card!.id, {})).toThrow('Pick the job this email is about.');
    email.confirm(card!.id, { jobId: canva.id });
    expect(notes.listForJob(canva.id)).toHaveLength(1);
  });

  it("a card follows the job's status now, so Confirm never moves it backwards", async () => {
    const s = await setup();
    s.mail.add({ from: 'careers@atlassian.com', subject: 'Interview invitation', text: 'We would like to invite you to an interview.' });
    await s.email.checkNow();
    expect(s.email.listSuggestions()[0]).toMatchObject({ event: 'interview', suggestedStatus: 'interview_1' });

    s.jobs.changeStatus(s.atlassian.id, 'final_interview', 'manual');
    const [card] = s.email.listSuggestions();
    expect(card!.suggestedStatus).toBeNull();
    expect(s.email.confirm(card!.id, {})).toMatchObject({ appliedStatus: null });
    expect(s.jobs.get(s.atlassian.id).status).toBe('final_interview');
    expect(s.notes.listForJob(s.atlassian.id)).toHaveLength(1);
  });

  it('a rejection you already recorded by hand only adds the note', async () => {
    const { email, jobs, atlassian, card } = await withCard();
    jobs.changeStatus(atlassian.id, 'rejected', 'manual');
    expect(email.listSuggestions()[0]!.suggestedStatus).toBeNull();
    expect(email.confirm(card.id, {})).toMatchObject({ appliedStatus: null });
  });

  it('dismiss leaves the job alone', async () => {
    const { email, jobs, notes, atlassian, card } = await withCard();
    expect(email.dismiss(card.id)).toMatchObject({ state: 'dismissed' });
    expect(jobs.get(atlassian.id).status).toBe('applied');
    expect(notes.listForJob(atlassian.id)).toEqual([]);
    expect(() => email.dismiss(card.id)).toThrow('This email was already handled.');
  });

  it('a suggestion that does not exist is not found', async () => {
    const { email } = await setup();
    expect(() => email.confirm(999, {})).toThrow('Suggestion 999 not found.');
    expect(() => email.dismiss(999)).toThrow('Suggestion 999 not found.');
  });
});

describe('email: the timer', () => {
  it('checks a minute after start, then every pollMinutes, and only while email is on', async () => {
    const { app, mail, email } = await setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    email.start();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(mail.fetches).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mail.fetches).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mail.fetches).toBe(2);

    const settings = app.services.settings;
    settings.update({ email: { ...settings.get().email, enabled: false } });
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(mail.fetches).toBe(2);

    settings.update({ email: { ...settings.get().email, enabled: true } });
    await vi.advanceTimersByTimeAsync(0);
    expect(mail.fetches).toBe(3);

    email.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(mail.fetches).toBe(3);
  });
});

describe('email: test connection', () => {
  it('says what went wrong, and never throws', async () => {
    const { mail, email } = await setup();
    expect(await email.test()).toEqual({ ok: true, detail: 'Connected to imap.gmail.com as me@gmail.com.' });
    mail.fail = new Error('Gmail refused the address or app password.');
    expect(await email.test()).toEqual({ ok: false, detail: 'Gmail refused the address or app password.' });
  });

  it('asks for the address and app password first', async () => {
    expect(await (await setup({ email: { address: '' } })).email.test()).toEqual({
      ok: false,
      detail: 'Add your Gmail address first: Settings → Email.',
    });
    await app!.cleanup();
    app = undefined;
    expect(await (await setup({ password: null })).email.test()).toEqual({
      ok: false,
      detail: 'Add your Gmail app password first: Settings → Email.',
    });
  });
});

describe('email: stopping', () => {
  it('closing the app during a check ends it at once, and saves nothing more', async () => {
    const s = await setup();
    s.mail.add(rejection);
    s.mail.delayMs = 5_000;
    const check = s.email.checkNow();
    const settled = check.then(
      () => 'resolved',
      (err: Error) => err.name,
    );
    await new Promise((r) => setTimeout(r, 20));
    const started = Date.now();
    await s.app.cleanup();
    app = undefined;
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await settled).toBe('AbortError');
  });
});
