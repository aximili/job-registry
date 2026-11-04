// The brief you check before the AI writes: made by the writing AI, saved
// with the job, edited as you go, and turned into what the writer gets. And
// the prep plan for an interview, made the same way. Through the real app,
// with a fake AI and an in-memory database.

import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Brief, BriefAnswer, BriefLine, PrepAnswer, PrepLine } from '../../../shared/contracts/index.ts';
import { defaultReply, FAKE_BRIEF, FAKE_PARSED, FAKE_PREP, FakeAiProvider } from '../../../tests/fakes/fake-ai-provider.ts';
import { FAIL_MESSAGE } from '../../../tests/fakes/smart-fake-ai.ts';
import { pastedCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';
import { AiUnavailableError, ConflictError, NotFoundError, ValidationError } from '../../core/errors.ts';

const AD = "Senior Engineer\nExample Co\nYou'll help our engineers ship faster. We want TypeScript and Go.";
const PROFILE = '# Sam Taylor\nSenior engineer at Example Co. Moved the web app to TypeScript.\n';
const NO_PROFILE = 'Add your master profile first: Settings → Profile.';
const NEWER = "There's a newer brief for this job. Reload the page to see it.";
const [GO, , TEAM] = FAKE_BRIEF.questions.map((q) => q.question) as [string, string, string];

let app: TestApp;
let provider: FakeAiProvider;
let jobId: number;
// 3 Nov 2026, at noon on this computer, so the local date is the same everywhere.
let clock: Date;
// What the app logged, warnings and worse.
let logged: { msg: string; err?: unknown }[];

function saveJob(fields: { title?: string; company?: string } = {}): number {
  const saved = app.services.jobs.save({ capture: pastedCapture(AD), fields });
  if (saved.result !== 'created') throw new Error('setup failed');
  return saved.job.id;
}

beforeEach(async () => {
  clock = new Date(2026, 10, 3, 12, 0, 0);
  provider = new FakeAiProvider();
  logged = [];
  const logger = pino({ level: 'warn' }, { write: (line: string) => void logged.push(JSON.parse(line) as { msg: string }) });
  app = await createTestApp({ fakes: { ai: provider }, now: () => clock, logger });
  jobId = saveJob({ title: 'Senior Engineer', company: 'Example Co' });
  await app.services.enrich.onIdle();
  app.services.profile.write('master-profile', PROFILE);
});

afterEach(async () => {
  await app.cleanup();
});

async function make(id = jobId) {
  const lines: BriefLine[] = [];
  const brief = await app.services.prep.makeBrief(id, { signal: new AbortController().signal, onLine: (line) => lines.push(line) });
  return { brief, lines };
}

async function plan(id = jobId) {
  const lines: PrepLine[] = [];
  const made = await app.services.prep.makePlan(id, { signal: new AbortController().signal, onLine: (line) => lines.push(line) });
  return { plan: made, lines };
}

const later = (minutes: number) => new Date(clock.getTime() + minutes * 60_000);
const userPart = (call: number) => provider.callsFor('brief')[call]!.messages[1]!.content;
const planPart = (call: number) => provider.callsFor('prep_plan')[call]!.messages[1]!.content;
const rows = (id = jobId) => (app.db.prepare('SELECT id FROM briefs WHERE job_id = ? ORDER BY id').all(id) as { id: number }[]).map((r) => r.id);
const answerLines = () => (app.services.profile.read('master-profile') ?? '').split('\n').filter((line) => /^- \d/.test(line));
const unanswered = { answer: null, skipped: false, addToProfile: false };
// Every question of a brief answered (an answer it has stays).
const answerAll = (b: Brief) =>
  app.services.prep.editBrief(b.id, {
    questions: b.questions.map((q) => ({ answer: q.answer ?? `Answer to ${q.question}`, skipped: false, addToProfile: q.addToProfile })),
  });
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!check()) throw new Error('timed out');
}

describe('makeBrief', () => {
  it('saves the brief, and sends waiting, then working with the writer, then done', async () => {
    const events: unknown[] = [];
    app.bus.on('brief.saved', (payload) => events.push(payload));
    const { brief, lines } = await make();

    expect(lines).toEqual([{ kind: 'waiting', by: 'Bonsai 2' }, { kind: 'working', by: 'Bonsai 2' }, { kind: 'done', brief }]);
    expect(brief).toMatchObject({
      jobId,
      by: 'Bonsai 2',
      createdAt: clock.toISOString(),
      updatedAt: clock.toISOString(),
      approvedAt: null,
      contact: FAKE_BRIEF.contact,
      // The quote is word for word in the ad.
      opening: { ...FAKE_BRIEF.opening, inAd: true },
      gaps: FAKE_BRIEF.gaps,
    });
    // Each need keeps its best story first, then the others to swap in.
    expect(brief.needs).toEqual(
      FAKE_BRIEF.needs.map((n) => ({ need: n.need, stories: [n.story, ...n.others], chosen: 0, dropped: false })),
    );
    expect(brief.questions).toEqual(
      FAKE_BRIEF.questions.map((q) => ({ ...q, answer: null, skipped: false, addToProfile: false, addedAt: null, fromEarlier: false })),
    );
    // With its time, so a tab can tell its own save from someone else's.
    expect(events).toEqual([{ jobId, briefId: brief.id, updatedAt: brief.updatedAt }]);
    expect(app.services.prep.brief(jobId)).toEqual(brief);
  });

  it("sends the job's details, its ad, its notes (newest first) and today's date to the AI", async () => {
    app.services.notes.add(jobId, 'Alex says the team is ten people.');
    clock = later(1);
    app.services.notes.add(jobId, 'Alex called back: the role is hybrid.');
    await make();
    const user = userPart(0);
    expect(user).toContain('Role: Senior Engineer\nCompany: Example Co');
    expect(user).toContain("You'll help our engineers ship faster.");
    expect(user).toContain('3 Nov 2026: Alex called back: the role is hybrid.\n3 Nov 2026: Alex says the team is ten people.');
    expect(user).toContain('Today is 3 November 2026.');
    // No earlier brief, so no earlier answers.
    expect(user).toContain('None yet.');
  });

  it("a second brief keeps the first, and gets the first's answers, but not the skipped or unanswered ones", async () => {
    const first = (await make()).brief;
    app.services.prep.editBrief(first.id, {
      questions: [
        { answer: 'Yes, a small CLI in Go.', skipped: false, addToProfile: false },
        { answer: 'Yes, but I skipped this.', skipped: true, addToProfile: false },
        unanswered,
      ],
    });
    clock = later(5);
    const second = (await make()).brief;

    expect(rows()).toEqual([first.id, second.id]);
    expect(app.services.prep.brief(jobId)).toEqual(second);
    expect(userPart(1)).toContain(`- ${GO} Yes, a small CLI in Go.`);
    expect(userPart(1)).not.toContain('skipped this');
    expect(userPart(1)).not.toContain(TEAM);
    // Your answer comes with it, first, as you left it; then the AI's new
    // questions, without the one you answered.
    expect(second.questions[0]).toEqual({ ...first.questions[0], answer: 'Yes, a small CLI in Go.', fromEarlier: true });
    expect(second.questions.slice(1).map((q) => q.question)).toEqual(FAKE_BRIEF.questions.slice(1).map((q) => q.question));
    expect(second.questions.slice(1).every((q) => q.answer === null)).toBe(true);
  });

  it('carries your answers on from brief to brief, with whether they go in your profile and when they did, 10 questions at most', async () => {
    let round = 0;
    provider.reply = (req) =>
      req.jsonSchema?.name === 'brief'
        ? JSON.stringify({ ...FAKE_BRIEF, questions: [1, 2, 3, 4, 5].map((n) => ({ question: `Round ${round}, question ${n}?`, why: 'It changes the letter.' })) })
        : defaultReply(req);
    round = 1;
    const first = (await make()).brief;
    app.services.prep.editBrief(first.id, {
      questions: first.questions.map((q, i) => ({ answer: `Answer to ${q.question}`, skipped: false, addToProfile: i === 0 })),
    });
    app.services.prep.addAnswersToProfile(first.id);
    const added = app.services.prep.brief(jobId)!.questions[0]!.addedAt;
    expect(added).not.toBeNull();

    round = 2;
    const second = (await make()).brief;
    const questions = (b: Brief) => b.questions.map((q) => q.question);
    expect(questions(second)).toEqual([...questions(first), ...[1, 2, 3, 4, 5].map((n) => `Round 2, question ${n}?`)]);
    expect(second.questions[0]).toMatchObject({ answer: 'Answer to Round 1, question 1?', addToProfile: true, addedAt: added });
    answerAll(second);

    // The third holds the second's answers, which hold the first's. The AI's new ones are past the 10.
    round = 3;
    const third = (await make()).brief;
    expect(questions(third)).toEqual(questions(second));
    expect(third.questions.every((q) => q.answer?.startsWith('Answer to '))).toBe(true);
    expect(third.questions[0]!.addedAt).toBe(added);
    // Every earlier answer still goes to the AI, so it doesn't ask again.
    expect(userPart(2)).toContain('- Round 1, question 1? Answer to Round 1, question 1?');
    expect(userPart(2)).toContain('- Round 2, question 5? Answer to Round 2, question 5?');
  });

  it("leaves out a new question that repeats one you answered, however it's spaced or cased", async () => {
    const first = (await make()).brief;
    app.services.prep.editBrief(first.id, { questions: [{ answer: 'Yes, a small CLI in Go.', skipped: false, addToProfile: false }, unanswered, unanswered] });
    const again = `  ${GO.toUpperCase().replace(/ /g, '   ')} `;
    provider.reply = (req) =>
      req.jsonSchema?.name === 'brief'
        ? JSON.stringify({ ...FAKE_BRIEF, questions: [{ question: again, why: 'Asked again.' }, { question: 'Is the role hybrid?', why: 'It changes the letter.' }] })
        : defaultReply(req);
    const second = (await make()).brief;
    expect(second.questions.map((q) => q.question)).toEqual([GO, 'Is the role hybrid?']);
    expect(second.questions[0]!.answer).toBe('Yes, a small CLI in Go.');
  });

  it('marks the answers it carried from an earlier brief, and a brief saved before the mark reads as carrying none', async () => {
    const first = (await make()).brief;
    expect(first.questions.map((q) => q.fromEarlier)).toEqual([false, false, false]);
    app.services.prep.editBrief(first.id, { questions: [{ answer: 'Yes, a small CLI in Go.', skipped: false, addToProfile: false }, unanswered, unanswered] });
    const second = (await make()).brief;
    expect(second.questions.map((q) => [q.question, q.fromEarlier])).toEqual([
      [GO, true],
      [FAKE_BRIEF.questions[1]!.question, false],
      [TEAM, false],
    ]);
    // An edit keeps the mark; answering a new question doesn't make it an earlier one.
    const edited = app.services.prep.editBrief(second.id, {
      questions: second.questions.map((q) => ({ answer: q.answer ?? 'Six of us.', skipped: false, addToProfile: false })),
    });
    expect(edited.questions.map((q) => q.fromEarlier)).toEqual([true, false, false]);

    const row = app.db.prepare('SELECT brief_json FROM briefs WHERE id = ?').get(second.id) as { brief_json: string };
    const stored = JSON.parse(row.brief_json) as { questions: Record<string, unknown>[] };
    for (const q of stored.questions) delete q.fromEarlier;
    app.db.prepare('UPDATE briefs SET brief_json = ? WHERE id = ?').run(JSON.stringify(stored), second.id);
    expect(app.services.prep.brief(jobId)!.questions.map((q) => q.fromEarlier)).toEqual([false, false, false]);
  });

  it('leaves out a new question that repeats an earlier one in the same answer, however it is spaced or cased', async () => {
    provider.reply = (req) =>
      req.jsonSchema?.name === 'brief'
        ? JSON.stringify({
            ...FAKE_BRIEF,
            questions: [
              { question: GO, why: 'It changes the letter.' },
              { question: 'Is the role hybrid?', why: 'It changes the letter.' },
              { question: ` ${GO.toLowerCase()}  `, why: 'Asked twice.' },
            ],
          })
        : defaultReply(req);
    const { brief } = await make();
    expect(brief.questions.map((q) => [q.question, q.why])).toEqual([
      [GO, 'It changes the letter.'],
      ['Is the role hybrid?', 'It changes the letter.'],
    ]);
  });

  it('sends your earlier answers newest first, so the latest still reach the AI when long answers pass its cap', async () => {
    let round = 0;
    provider.reply = (req) =>
      req.jsonSchema?.name === 'brief'
        ? JSON.stringify({ ...FAKE_BRIEF, questions: [1, 2, 3, 4, 5].map((n) => ({ question: `Round ${round}, question ${n}?`, why: 'It changes the letter.' })) })
        : defaultReply(req);
    // Every question answered, each at its 240 characters.
    const answerLong = (b: Brief) =>
      app.services.prep.editBrief(b.id, {
        questions: b.questions.map((q) => ({ answer: q.answer ?? 'x'.repeat(240), skipped: false, addToProfile: false })),
      });
    round = 1;
    answerLong((await make()).brief);
    round = 2;
    answerLong((await make()).brief);
    round = 3;
    await make();

    const user = userPart(2);
    const at = (question: string) => user.indexOf(`- ${question} x`);
    expect(at('Round 2, question 5?')).toBeGreaterThan(-1);
    expect(at('Round 2, question 5?')).toBeLessThan(at('Round 2, question 1?'));
    expect(at('Round 2, question 1?')).toBeLessThan(at('Round 1, question 5?'));
    // The oldest are past the 2,000 characters.
    expect(user).not.toContain('Round 1, question 1?');
  });

  it('carries an answer you typed into the last brief while the new one was being made', async () => {
    const first = (await make()).brief;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    provider.reply = async (req) => {
      if (req.jsonSchema?.name === 'brief') await held;
      return defaultReply(req);
    };
    const making = make();
    await until(() => provider.callsFor('brief').length === 2);
    app.services.prep.editBrief(first.id, { questions: [{ answer: 'Yes, a small CLI in Go.', skipped: false, addToProfile: true }, unanswered, unanswered] });
    release();
    const second = (await making).brief;
    expect(second.questions[0]).toMatchObject({ question: GO, answer: 'Yes, a small CLI in Go.', addToProfile: true, addedAt: null });
    // The AI asked it again, not knowing the answer: it shows once, answered.
    expect(second.questions.filter((q) => q.question === GO)).toHaveLength(1);
    // The AI got the answers as they were when it started.
    expect(userPart(1)).toContain('None yet.');
  });

  it("a brief that can't be read counts as none, and is logged, so New brief gets past it", async () => {
    const broken = (await make()).brief;
    app.db.prepare('UPDATE briefs SET brief_json = ? WHERE id = ?').run('{"needs": "not a list"}', broken.id);
    expect(app.services.prep.brief(jobId)).toBeNull();
    const fresh = (await make()).brief;
    expect(fresh.id).not.toBe(broken.id);
    expect(fresh.questions.map((q) => q.answer)).toEqual([null, null, null]);
    expect(app.services.prep.brief(jobId)).toEqual(fresh);
    expect(logged.map((l) => l.msg)).toContain(`The newest brief for job ${jobId} can't be read, so it counts as none.`);
    expect(logged.find((l) => l.msg.startsWith('The newest brief'))?.err).toBeDefined();
  });

  it('refuses a missing job, and a missing master profile, before any line or AI call', () => {
    const lines: BriefLine[] = [];
    const start = (id: number) => app.services.prep.makeBrief(id, { signal: new AbortController().signal, onLine: (l) => lines.push(l) });
    expect(() => start(999)).toThrow(NotFoundError);
    app.services.profile.write('master-profile', '  ');
    expect(() => start(jobId)).toThrow(ValidationError);
    expect(() => start(jobId)).toThrow(NO_PROFILE);
    expect(lines).toEqual([]);
    expect(provider.callsFor('brief')).toEqual([]);
  });

  it('saves a brief with no needs as it is, and the writer gets none', async () => {
    provider.reply = (req) => (req.jsonSchema?.name === 'brief' ? JSON.stringify({ ...FAKE_BRIEF, needs: [] }) : defaultReply(req));
    const { brief } = await make();
    expect(brief.needs).toEqual([]);
    expect(provider.callsFor('brief')).toHaveLength(1);
    expect(app.services.prep.brief(jobId)).toEqual(brief);
    expect(app.services.prep.approvedBrief(jobId)!.needs).toEqual([]);
  });

  it("saves nothing when the AI can't make it", async () => {
    provider.reply = (req) => (req.jsonSchema?.name === 'brief' ? new AiUnavailableError(FAIL_MESSAGE) : defaultReply(req));
    await expect(make()).rejects.toThrow(FAIL_MESSAGE);
    expect(app.services.prep.brief(jobId)).toBeNull();
  });

  it('a job with no brief has none', () => {
    expect(app.services.prep.brief(jobId)).toBeNull();
    expect(() => app.services.prep.brief(999)).toThrow(NotFoundError);
  });
});

describe('editBrief', () => {
  it("changes the contact, each need's story and whether it's dropped, and each answer", async () => {
    const { brief } = await make();
    const events: unknown[] = [];
    app.bus.on('brief.saved', (payload) => events.push(payload));
    clock = later(2);
    const edited = app.services.prep.editBrief(brief.id, {
      contact: { name: 'Alex Chen', recruiter: false },
      needs: [
        { chosen: 2, dropped: false },
        { chosen: 0, dropped: true },
        { chosen: 1, dropped: false },
      ],
      questions: [
        { answer: ' Yes, a small CLI in Go. ', skipped: false, addToProfile: true },
        { answer: null, skipped: true, addToProfile: false },
        unanswered,
      ],
    });

    expect(edited.contact).toEqual({ ...FAKE_BRIEF.contact, name: 'Alex Chen', recruiter: false });
    expect(edited.needs.map((n) => [n.chosen, n.dropped])).toEqual([
      [2, false],
      [0, true],
      [1, false],
    ]);
    expect(edited.needs.map((n) => n.stories)).toEqual(brief.needs.map((n) => n.stories));
    expect(edited.questions.map(({ answer, skipped, addToProfile }) => ({ answer, skipped, addToProfile }))).toEqual([
      { answer: 'Yes, a small CLI in Go.', skipped: false, addToProfile: true },
      { answer: null, skipped: true, addToProfile: false },
      unanswered,
    ]);
    expect(edited).toMatchObject({ createdAt: brief.createdAt, updatedAt: clock.toISOString() });
    expect(app.services.prep.brief(jobId)).toEqual(edited);
    expect(events).toEqual([{ jobId, briefId: brief.id, updatedAt: edited.updatedAt }]);
  });

  it('leaves the parts it is not sent as they were; a blank name or answer is none', async () => {
    const { brief } = await make();
    const first = app.services.prep.editBrief(brief.id, { needs: [{ chosen: 1, dropped: false }, { chosen: 0, dropped: false }, { chosen: 0, dropped: false }] });
    const second = app.services.prep.editBrief(brief.id, {
      contact: { name: '   ', recruiter: true },
      questions: [{ answer: '  ', skipped: false, addToProfile: true }, unanswered, unanswered],
    });
    expect(second.contact.name).toBeNull();
    expect(second.questions[0]!.answer).toBeNull();
    expect(second.needs).toEqual(first.needs);
    expect(second.gaps).toEqual(brief.gaps);
    expect(second.opening).toEqual(brief.opening);
  });

  it('refuses a list of the wrong length, and a story the need does not have', async () => {
    // One need with two stories.
    const short: BriefAnswer = { ...FAKE_BRIEF, needs: [{ ...FAKE_BRIEF.needs[0]!, others: [FAKE_BRIEF.needs[0]!.others[0]!] }] };
    provider.reply = (req) => (req.jsonSchema?.name === 'brief' ? JSON.stringify(short) : defaultReply(req));
    const { brief } = await make();
    const edit = (edits: Parameters<typeof app.services.prep.editBrief>[1]) => () => app.services.prep.editBrief(brief.id, edits);

    expect(edit({ needs: [] })).toThrow(ValidationError);
    expect(edit({ needs: [{ chosen: 0, dropped: false }, { chosen: 0, dropped: false }] })).toThrow(ValidationError);
    expect(edit({ questions: [unanswered] })).toThrow(ValidationError);
    expect(edit({ needs: [{ chosen: 2, dropped: false }] })).toThrow(ValidationError);
    expect(app.services.prep.brief(jobId)).toEqual(brief);
    // The second story is there.
    expect(app.services.prep.editBrief(brief.id, { needs: [{ chosen: 1, dropped: false }] }).needs[0]!.chosen).toBe(1);
  });

  it('refuses a brief that is not there', () => {
    expect(() => app.services.prep.editBrief(999, { contact: { name: 'Alex', recruiter: true } })).toThrow(NotFoundError);
  });

  // Review Focus 2: two tabs, or a "New brief" while an edit is on its way.
  it('refuses an edit to a brief that is not the newest, with a sentence, and changes nothing', async () => {
    const first = (await make()).brief;
    const second = (await make()).brief;
    const edit = () => app.services.prep.editBrief(first.id, { contact: { name: 'Alex Chen', recruiter: false } });
    expect(edit).toThrow(ConflictError);
    expect(edit).toThrow(NEWER);
    const res = await app.request('PATCH', `/api/v1/briefs/${first.id}`, { contact: { name: 'Alex Chen', recruiter: false } });
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'conflict', message: NEWER });
    expect(() => app.services.prep.addAnswersToProfile(first.id)).toThrow(NEWER);
    // The newest still takes edits.
    expect(app.services.prep.editBrief(second.id, { contact: { name: 'Alex Chen', recruiter: false } }).contact.name).toBe('Alex Chen');
  });
});

// Review Focus 3: "Add to my profile" twice adds each answer once.
describe('addAnswersToProfile', () => {
  it('adds one line per ticked, answered question, in the format, and marks them added', async () => {
    const { brief } = await make();
    app.services.prep.editBrief(brief.id, {
      questions: [
        { answer: 'Yes, a small CLI in Go.', skipped: false, addToProfile: true },
        // Skipped: never added, even when ticked.
        { answer: 'Yes, you can name it.', skipped: true, addToProfile: true },
        // Not ticked: never added.
        { answer: 'Ten people.', skipped: false, addToProfile: false },
      ],
    });
    clock = later(1);
    expect(app.services.prep.addAnswersToProfile(brief.id)).toEqual({ added: 1 });

    expect(app.services.profile.read('master-profile')).toBe(
      `${PROFILE}\n## Answers from my applications\n- 3 Nov 2026, Senior Engineer at Example Co: ${GO} Yes, a small CLI in Go.\n`,
    );
    const saved = app.services.prep.brief(jobId)!;
    expect(saved.questions.map((q) => q.addedAt)).toEqual([clock.toISOString(), null, null]);
    expect(saved.updatedAt).toBe(clock.toISOString());
  });

  it('adds nothing the second time, and an answer changed after it was added goes in again as a new line', async () => {
    const { brief } = await make();
    const answer = (text: string) => ({ questions: [{ answer: text, skipped: false, addToProfile: true }, unanswered, unanswered] });
    app.services.prep.editBrief(brief.id, answer('Yes, a small CLI in Go.'));
    expect(app.services.prep.addAnswersToProfile(brief.id)).toEqual({ added: 1 });
    expect(app.services.prep.addAnswersToProfile(brief.id)).toEqual({ added: 0 });
    // The same answer sent again keeps it marked as added.
    expect(app.services.prep.editBrief(brief.id, answer('Yes, a small CLI in Go.')).questions[0]!.addedAt).not.toBeNull();
    expect(app.services.prep.addAnswersToProfile(brief.id)).toEqual({ added: 0 });
    expect(answerLines()).toEqual([`- 3 Nov 2026, Senior Engineer at Example Co: ${GO} Yes, a small CLI in Go.`]);

    clock = new Date(2026, 10, 4, 9, 0, 0);
    expect(app.services.prep.editBrief(brief.id, answer('Yes, two small CLIs in Go.')).questions[0]!.addedAt).toBeNull();
    expect(app.services.prep.addAnswersToProfile(brief.id)).toEqual({ added: 1 });
    expect(answerLines()).toEqual([
      `- 3 Nov 2026, Senior Engineer at Example Co: ${GO} Yes, a small CLI in Go.`,
      `- 4 Nov 2026, Senior Engineer at Example Co: ${GO} Yes, two small CLIs in Go.`,
    ]);

    // Changed back: that answer is in your profile already, so it isn't added
    // again, but it's marked as added.
    expect(app.services.prep.editBrief(brief.id, answer('Yes, a small CLI in Go.')).questions[0]!.addedAt).toBeNull();
    expect(app.services.prep.addAnswersToProfile(brief.id)).toEqual({ added: 0 });
    expect(answerLines()).toHaveLength(2);
    expect(app.services.prep.brief(jobId)!.questions[0]!.addedAt).toBe(clock.toISOString());
  });

  it('a second try after the brief could not be saved adds nothing again', async () => {
    const { brief } = await make();
    app.services.prep.editBrief(brief.id, { questions: [{ answer: 'Yes, a small CLI in Go.', skipped: false, addToProfile: true }, unanswered, unanswered] });
    app.db.exec("CREATE TRIGGER no_saves BEFORE UPDATE ON briefs BEGIN SELECT RAISE(ABORT, 'The disk is full.'); END;");
    expect(() => app.services.prep.addAnswersToProfile(brief.id)).toThrow('The disk is full.');
    // The profile has the line, but the brief doesn't know.
    expect(answerLines()).toHaveLength(1);
    expect(app.services.prep.brief(jobId)!.questions[0]!.addedAt).toBeNull();

    app.db.exec('DROP TRIGGER no_saves');
    expect(app.services.prep.addAnswersToProfile(brief.id)).toEqual({ added: 0 });
    expect(answerLines()).toEqual([`- 3 Nov 2026, Senior Engineer at Example Co: ${GO} Yes, a small CLI in Go.`]);
    expect(app.services.prep.brief(jobId)!.questions[0]!.addedAt).not.toBeNull();
  });

  it('leaves out the role or the company when the job has none', async () => {
    provider.reply = (req) =>
      req.jsonSchema?.name === 'parsed_job' ? JSON.stringify({ ...FAKE_PARSED, title: null, company: null }) : defaultReply(req);
    const bare = saveJob();
    const companyOnly = saveJob({ company: 'Example Co' });
    await app.services.enrich.onIdle();
    for (const [id, answer] of [[bare, 'Yes.'], [companyOnly, 'Yes, at home.']] as const) {
      const { brief } = await make(id);
      app.services.prep.editBrief(brief.id, { questions: [{ answer, skipped: false, addToProfile: true }, unanswered, unanswered] });
      app.services.prep.addAnswersToProfile(brief.id);
    }
    expect(answerLines()).toEqual([`- 3 Nov 2026: ${GO} Yes.`, `- 3 Nov 2026, Example Co: ${GO} Yes, at home.`]);
  });

  it('the same answer to the same question, from another job, is in your profile already, so it is not added twice', async () => {
    const other = saveJob({ title: 'Lead Engineer', company: 'Example Co' });
    for (const id of [jobId, other]) {
      const { brief } = await make(id);
      app.services.prep.editBrief(brief.id, { questions: [{ answer: 'Yes, a small CLI.', skipped: false, addToProfile: true }, unanswered, unanswered] });
      expect(app.services.prep.addAnswersToProfile(brief.id)).toEqual({ added: id === jobId ? 1 : 0 });
      expect(app.services.prep.brief(id)!.questions[0]!.addedAt).not.toBeNull();
    }
    expect(answerLines()).toEqual([`- 3 Nov 2026, Senior Engineer at Example Co: ${GO} Yes, a small CLI.`]);
  });

  it('changes nothing in the profile when there is nothing to add', async () => {
    const { brief } = await make();
    expect(app.services.prep.addAnswersToProfile(brief.id)).toEqual({ added: 0 });
    expect(app.services.profile.read('master-profile')).toBe(PROFILE);
  });
});

describe('approvedBrief', () => {
  it('gives the writer the chosen stories, without dropped needs or unanswered and skipped questions, and marks it approved', async () => {
    const { brief } = await make();
    app.services.prep.editBrief(brief.id, {
      needs: [
        { chosen: 1, dropped: false },
        { chosen: 0, dropped: true },
        { chosen: 2, dropped: false },
      ],
      questions: [{ answer: 'Yes, a small CLI in Go.', skipped: false, addToProfile: false }, { answer: 'Yes.', skipped: true, addToProfile: false }, unanswered],
    });
    clock = later(3);
    const [first, , third] = FAKE_BRIEF.needs as [BriefAnswer['needs'][0], unknown, BriefAnswer['needs'][0]];

    expect(app.services.prep.approvedBrief(jobId)).toEqual({
      contact: FAKE_BRIEF.contact,
      opening: FAKE_BRIEF.opening,
      needs: [
        { need: first.need, story: first.others[0] },
        { need: third.need, story: third.others[1] },
      ],
      gaps: FAKE_BRIEF.gaps,
      answers: [{ question: GO, answer: 'Yes, a small CLI in Go.' }],
    });
    expect(app.services.prep.brief(jobId)!.approvedAt).toBe(clock.toISOString());
  });

  it('uses the newest brief, and is null when the job has none', async () => {
    expect(app.services.prep.approvedBrief(jobId)).toBeNull();
    const first = (await make()).brief;
    const second = (await make()).brief;
    app.services.prep.editBrief(second.id, { contact: { name: 'Alex Chen', recruiter: true } });
    expect(app.services.prep.approvedBrief(jobId)!.contact.name).toBe('Alex Chen');
    const approved = app.db.prepare('SELECT id, approved_at FROM briefs WHERE job_id = ? ORDER BY id').all(jobId) as { id: number; approved_at: string | null }[];
    expect(approved).toEqual([
      { id: first.id, approved_at: null },
      { id: second.id, approved_at: clock.toISOString() },
    ]);
  });
});

describe('makePlan', () => {
  it('saves the plan with the name of the AI that made it, and sends waiting, then working, then done', async () => {
    const events: unknown[] = [];
    app.bus.on('prep.saved', (payload) => events.push(payload));
    const { plan: made, lines } = await plan();

    expect(lines).toEqual([{ kind: 'waiting', by: 'Bonsai 2' }, { kind: 'working', by: 'Bonsai 2' }, { kind: 'done', plan: made }]);
    expect(made).toEqual({ ...FAKE_PREP, id: made.id, jobId, by: 'Bonsai 2', createdAt: clock.toISOString() });
    expect(events).toEqual([{ jobId, planId: made.id, createdAt: made.createdAt }]);
    expect(app.services.prep.plans(jobId)).toEqual([made]);
  });

  it('a new plan keeps the old ones, and the plans are newest first', async () => {
    const first = (await plan()).plan;
    clock = later(5);
    const second = (await plan()).plan;
    // Made in the same moment: the one made last is first.
    const third = (await plan()).plan;
    // The computer's clock went back: the one made last is still first, as for briefs.
    clock = later(-60);
    const fourth = (await plan()).plan;
    expect(app.services.prep.plans(jobId).map((p) => p.id)).toEqual([fourth.id, third.id, second.id, first.id]);
    expect(app.services.prep.plans(jobId)[3]).toEqual(first);
  });

  it("sends the job's details, its ad, its notes and today's date, and the newest brief's needs, gaps and answers, without marking it approved", async () => {
    app.services.notes.add(jobId, 'Alex says the interview is on Friday.');
    await make();
    clock = later(1);
    const { brief } = await make();
    app.services.prep.editBrief(brief.id, {
      needs: [
        { chosen: 1, dropped: false },
        { chosen: 0, dropped: true },
        { chosen: 0, dropped: false },
      ],
      questions: [{ answer: 'Yes, a small CLI in Go.', skipped: false, addToProfile: false }, { answer: 'Yes.', skipped: true, addToProfile: false }, unanswered],
    });
    await plan();

    const user = planPart(0);
    const [first, second, third] = FAKE_BRIEF.needs as [BriefAnswer['needs'][0], BriefAnswer['needs'][0], BriefAnswer['needs'][0]];
    expect(user).toContain('Role: Senior Engineer\nCompany: Example Co');
    expect(user).toContain("You'll help our engineers ship faster.");
    expect(user).toContain('3 Nov 2026: Alex says the interview is on Friday.');
    expect(user).toContain('Today is 3 November 2026.');
    // The story you chose for each need you kept.
    expect(user).toContain(`- ${first.need}\n  ${first.others[0]!.title}: ${first.others[0]!.text}`);
    expect(user).toContain(`- ${third.need}\n  ${third.story.title}: ${third.story.text}`);
    expect(user).not.toContain(second.need);
    expect(user).toContain(`- Go: ${FAKE_BRIEF.gaps[0]!.evidence}`);
    expect(user).toContain(`- ${GO} Yes, a small CLI in Go.`);
    expect(user).not.toContain('Can I name the Example Co web app');
    // Who to write to and the opening line are the cover letter's only.
    expect(user).not.toContain(FAKE_BRIEF.contact.email!);
    expect(user).not.toContain(FAKE_BRIEF.opening.why);
    expect(app.services.prep.brief(jobId)!.approvedAt).toBeNull();
  });

  it("says there's no brief when the job has none, or its newest can't be read", async () => {
    await plan();
    expect(planPart(0)).toContain('No brief yet.');
    expect(planPart(0)).not.toContain('Needs, each with the story to tell:');

    const broken = (await make()).brief;
    app.db.prepare('UPDATE briefs SET brief_json = ? WHERE id = ?').run('{"needs": "not a list"}', broken.id);
    await plan();
    expect(planPart(1)).toContain('No brief yet.');
  });

  it('saves a plan without its links, and a topic left with one step or none still reads back', async () => {
    const linked: PrepAnswer = {
      ...FAKE_PREP,
      learn: [
        { ...FAKE_PREP.learn[0]!, steps: ['Do the Go tour (https://go.dev/tour).', 'www.example.com/go-course'] },
        { ...FAKE_PREP.learn[1]!, steps: ['https://example.com/caching', 'www.example.com/pipelines'] },
      ],
      ask: [{ question: 'What does a typical week look like?', why: 'The ad (www.example.com/careers) does not say.' }],
    };
    provider.reply = (req) => (req.jsonSchema?.name === 'prep_plan' ? JSON.stringify(linked) : defaultReply(req));
    const { plan: made } = await plan();

    expect(made.learn.map((l) => l.steps)).toEqual([['Do the Go tour.'], []]);
    expect(made.ask[0]!.why).toBe('The ad does not say.');
    expect(JSON.stringify(made)).not.toMatch(/https?:|www\./);
    expect(app.services.prep.plans(jobId)).toEqual([made]);
  });

  it('a new plan for the same job replaces one still being made', async () => {
    provider.delayMs = 200;
    const replaced = plan();
    await until(() => provider.callsFor('prep_plan').length === 1);
    const newer = plan();
    await expect(replaced).rejects.toMatchObject({ name: 'AbortError' });
    const { plan: made } = await newer;
    expect(app.services.prep.plans(jobId)).toEqual([made]);
  });

  it('refuses a missing job, and a missing master profile, before any line or AI call', () => {
    const lines: PrepLine[] = [];
    const start = (id: number) => app.services.prep.makePlan(id, { signal: new AbortController().signal, onLine: (l) => lines.push(l) });
    expect(() => start(999)).toThrow(NotFoundError);
    app.services.profile.write('master-profile', '  ');
    expect(() => start(jobId)).toThrow(ValidationError);
    expect(() => start(jobId)).toThrow(NO_PROFILE);
    expect(lines).toEqual([]);
    expect(provider.callsFor('prep_plan')).toEqual([]);
  });

  it("saves nothing when the AI can't make it, and tells no one it did", async () => {
    const events: unknown[] = [];
    app.bus.on('prep.saved', (payload) => events.push(payload));
    provider.reply = (req) => (req.jsonSchema?.name === 'prep_plan' ? new AiUnavailableError(FAIL_MESSAGE) : defaultReply(req));
    await expect(plan()).rejects.toThrow(FAIL_MESSAGE);
    expect(app.services.prep.plans(jobId)).toEqual([]);
    expect(events).toEqual([]);
  });

  it("a job with no plans has none, and an unknown job's plans are not found", () => {
    expect(app.services.prep.plans(jobId)).toEqual([]);
    expect(() => app.services.prep.plans(999)).toThrow(NotFoundError);
  });

  it("leaves out a plan that can't be read, and logs it, so the rest still show", async () => {
    const first = (await plan()).plan;
    const broken = (await plan()).plan;
    app.db.prepare('UPDATE prep_plans SET plan_json = ? WHERE id = ?').run('{"learn": "not a list"}', broken.id);
    expect(app.services.prep.plans(jobId)).toEqual([first]);
    expect(logged.map((l) => l.msg)).toContain(`Prep plan ${broken.id} can't be read, so it's left out.`);
    expect(logged.find((l) => l.msg.startsWith('Prep plan'))?.err).toBeDefined();
  });
});
