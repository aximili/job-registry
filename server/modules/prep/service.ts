// Getting ready to write: the brief you check before the AI writes a cover
// letter or resume. The writing AI makes it from your profile, the job, its
// ad and notes, and your answers in the job's last brief. It's saved with
// the job; every edit saves at once; a new brief is a new row, and the
// newest is the job's. Your answers carry on into each new brief. See the
// spec's "Before I write".
//
// And getting ready for an interview: the prep plan ("Get ready"), made the
// same way, with the job's newest brief when it has one. A new plan is a new
// row too, and the old ones stay. See the spec's "Get ready for a job".

import { z } from 'zod';
import {
  BRIEF_QUESTIONS_KEPT,
  type Brief,
  type BriefBody,
  type BriefEdits,
  type BriefLine,
  type PrepLine,
  type PrepPlan,
  type WriterBrief,
} from '../../../shared/contracts/index.ts';
import { formatDate, localDate, longDate } from '../../../shared/dates.ts';
import { describeJob, jobNotes } from '../../../shared/job-text.ts';
import { NO_PROFILE } from '../../../shared/labels.ts';
import type { Clock } from '../../core/config.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.ts';
import type { EventBus } from '../../core/events.ts';
import type { Logger } from '../../core/logger.ts';
import type { AiService, CutBrief } from '../ai/index.ts';
import type { JobsService } from '../jobs/index.ts';
import type { NotesService } from '../notes/index.ts';
import type { ProfileService } from '../profile/index.ts';
import type { PrepRepo } from './repo.ts';

export interface PrepService {
  // The job's newest brief, or null when it has none (or it can't be read).
  brief(jobId: number): Brief | null;
  // Makes a new brief with the writing AI, sending each line as it goes:
  // waiting at once (with the writing AI picked), working when the AI starts
  // (with the AI it runs on), done with the saved brief. A missing job or
  // master profile throws at once, before any line.
  makeBrief(jobId: number, o: { signal: AbortSignal; onLine: (line: BriefLine) => void }): Promise<Brief>;
  // Only the job's newest brief takes edits.
  editBrief(id: number, edits: BriefEdits): Brief;
  // The newest brief as the writer gets it, marked as written with. Null
  // when the job has none. With briefId (the brief on screen), a brief that
  // isn't the newest any more is a ConflictError, and nothing is marked.
  approvedBrief(jobId: number, briefId?: number): WriterBrief | null;
  // Adds each ticked answer not yet added to the end of your master profile.
  // added counts the lines it wrote.
  addAnswersToProfile(id: number): { added: number };
  // The job's prep plans, newest first.
  plans(jobId: number): PrepPlan[];
  // Makes a new prep plan with the writing AI, sending each line as it goes,
  // as makeBrief does. It uses the job's newest brief, without marking it
  // approved. A missing job or master profile throws at once, before any line.
  makePlan(jobId: number, o: { signal: AbortSignal; onLine: (line: PrepLine) => void }): Promise<PrepPlan>;
}

export type PrepOptions = {
  repo: PrepRepo;
  bus: EventBus;
  now: Clock;
  logger: Logger;
  ai: AiService;
  profile: ProfileService;
  jobs: JobsService;
  notes: NotesService;
};

type Question = BriefBody['questions'][number];

const NEWER = "There's a newer brief for this job. Reload the page to see it.";
const DOES_NOT_FIT = "This change doesn't fit the brief. Reload the page to see it.";

// One line: runs of spaces and line breaks become one space.
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();

// The questions you answered and didn't skip, as they are.
const answeredIn = (brief: Brief | undefined): Question[] => (brief ? brief.questions.filter((q) => !q.skipped && q.answer) : []);
const asAnswers = (questions: Question[]) => questions.map((q) => ({ question: q.question, answer: q.answer! }));

// A question as it's compared: in lower case, on one line.
const asKey = (question: string): string => flat(question).toLowerCase();

// The brief as the AI made it, ready to save: each need with its best story
// first, then the others. Your answers from the last brief come first, as
// they were, marked as from an earlier brief; then the AI's new questions,
// unanswered, leaving out any that asks one of yours again, or one it asked
// already; 10 at most.
function bodyOf(brief: CutBrief, carried: Question[]): BriefBody {
  const seen = new Set(carried.map((q) => asKey(q.question)));
  const asked = brief.questions
    .filter((q) => {
      const key = asKey(q.question);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((q) => ({ ...q, answer: null, skipped: false, addToProfile: false, addedAt: null, fromEarlier: false }));
  return {
    contact: brief.contact,
    opening: brief.opening,
    needs: brief.needs.map((n) => ({ need: n.need, stories: [n.story, ...n.others], chosen: 0, dropped: false })),
    gaps: brief.gaps,
    questions: [...carried.map((q) => ({ ...q, fromEarlier: true })), ...asked].slice(0, BRIEF_QUESTIONS_KEPT),
  };
}

const partsOf = ({ contact, opening, needs, gaps, questions }: Brief): BriefBody => ({ contact, opening, needs, gaps, questions });

// A brief as the writer gets it: the story you chose for each need you kept,
// and the questions you answered. Marks nothing.
export function writerBriefOf(brief: Brief): WriterBrief {
  return {
    contact: brief.contact,
    opening: { quote: brief.opening.quote, why: brief.opening.why },
    needs: brief.needs.filter((n) => !n.dropped).map((n) => ({ need: n.need, story: n.stories[n.chosen]! })),
    gaps: brief.gaps,
    answers: asAnswers(answeredIn(brief)),
  };
}

// Each list sent has one entry per item in the brief, in order.
function fits(list: unknown[] | undefined, own: unknown[]): void {
  if (list && list.length !== own.length) throw new ValidationError(DOES_NOT_FIT);
}

export function createPrepService(opts: PrepOptions): PrepService {
  const { repo, bus } = opts;

  function getBrief(id: number): Brief {
    const brief = repo.getBrief(id);
    if (!brief) throw new NotFoundError(`Brief ${id} not found`);
    return brief;
  }

  // The job's brief: its newest. One that can't be read (a broken row)
  // counts as none, so a new brief gets you past it.
  function newest(jobId: number): Brief | undefined {
    try {
      return repo.newestBrief(jobId);
    } catch (err) {
      if (!(err instanceof z.ZodError) && !(err instanceof SyntaxError)) throw err;
      opts.logger.warn({ err }, `The newest brief for job ${jobId} can't be read, so it counts as none.`);
      return undefined;
    }
  }

  // An edit to a brief that isn't the job's newest would be lost from view:
  // the page shows the newest.
  function newestOrThrow(id: number): Brief {
    const brief = getBrief(id);
    if (newest(brief.jobId)?.id !== id) throw new ConflictError(NEWER);
    return brief;
  }

  // What the AI gets about the job, for a brief or a plan. A missing job or
  // master profile throws at once.
  function aboutJob(jobId: number) {
    const job = opts.jobs.get(jobId);
    const profile = opts.profile.read('master-profile');
    if (!profile) throw new ValidationError(NO_PROFILE);
    return {
      profile,
      job: describeJob(job),
      ad: opts.jobs.listPostings(jobId)[0]?.jdText ?? '',
      notes: jobNotes(opts.notes.listForJob(jobId)),
      today: longDate(opts.now()),
    };
  }

  function save(brief: Brief, body: BriefBody, at = opts.now().toISOString()): Brief {
    repo.updateBrief(brief.id, body, at);
    const saved = getBrief(brief.id);
    bus.emit('brief.saved', { jobId: saved.jobId, briefId: saved.id, updatedAt: saved.updatedAt });
    return saved;
  }

  return {
    brief(jobId) {
      opts.jobs.get(jobId);
      return newest(jobId) ?? null;
    },

    makeBrief(jobId, o) {
      const about = aboutJob(jobId);
      // Your earlier answers, so the AI doesn't ask again. The newest come
      // first, so they're the ones kept when there are too many to send.
      const answers = asAnswers(answeredIn(newest(jobId))).reverse();
      const input = { ...about, answers };
      return (async () => {
        const { brief, by } = await opts.ai.briefJob(input, {
          signal: o.signal,
          // A new brief for the same job replaces one still being made.
          key: `brief-${jobId}`,
          onQueued: (name) => o.onLine({ kind: 'waiting', by: name }),
          onStart: (name) => o.onLine({ kind: 'working', by: name }),
        });
        // Read again: you may have answered more while the AI worked.
        const carried = answeredIn(newest(jobId));
        const saved = repo.insertBrief(jobId, bodyOf(brief, carried), by, opts.now().toISOString());
        bus.emit('brief.saved', { jobId, briefId: saved.id, updatedAt: saved.updatedAt });
        o.onLine({ kind: 'done', brief: saved });
        return saved;
      })();
    },

    editBrief(id, edits) {
      const brief = newestOrThrow(id);
      fits(edits.needs, brief.needs);
      fits(edits.questions, brief.questions);
      edits.needs?.forEach((e, i) => {
        if (e.chosen >= brief.needs[i]!.stories.length) throw new ValidationError(DOES_NOT_FIT);
      });
      const body = partsOf(brief);
      if (edits.contact) body.contact = { ...brief.contact, name: edits.contact.name?.trim() || null, recruiter: edits.contact.recruiter };
      if (edits.needs) body.needs = brief.needs.map((n, i) => ({ ...n, chosen: edits.needs![i]!.chosen, dropped: edits.needs![i]!.dropped }));
      if (edits.questions) {
        body.questions = brief.questions.map((q, i) => {
          const e = edits.questions![i]!;
          const answer = e.answer?.trim() || null;
          // A changed answer goes in your profile again, as a new line.
          return { ...q, answer, skipped: e.skipped, addToProfile: e.addToProfile, addedAt: answer === q.answer ? q.addedAt : null };
        });
      }
      return save(brief, body);
    },

    approvedBrief(jobId, briefId) {
      const brief = newest(jobId);
      if (!brief) return null;
      if (briefId !== undefined && brief.id !== briefId) throw new ConflictError(NEWER);
      repo.approveBrief(brief.id, opts.now().toISOString());
      return writerBriefOf(brief);
    },

    addAnswersToProfile(id) {
      const brief = newestOrThrow(id);
      const due = brief.questions.map((q) => q.addToProfile && !q.skipped && !!q.answer && !q.addedAt);
      if (!due.some(Boolean)) return { added: 0 };
      const job = opts.jobs.get(brief.jobId);
      // "3 Nov 2026, Senior Engineer at Example Co", leaving out what isn't known.
      const about = [formatDate(localDate(opts.now())), [job.title, job.company].filter(Boolean).join(' at ')].filter(Boolean).join(', ');
      // An answer already in your profile isn't added again (one you changed
      // back, or a second try after the brief couldn't be saved), but it's
      // still marked as added.
      const known = opts.profile.answerLines().map(flat);
      const lines: string[] = [];
      brief.questions.forEach((q, i) => {
        if (!due[i]) return;
        const said = flat(`${q.question} ${q.answer}`);
        if (known.some((line) => line === said || line.endsWith(` ${said}`))) return;
        known.push(said);
        lines.push(`- ${about}: ${said}`);
      });
      if (lines.length > 0) opts.profile.appendAnswers(lines);
      const at = opts.now().toISOString();
      save(brief, { ...partsOf(brief), questions: brief.questions.map((q, i) => (due[i] ? { ...q, addedAt: at } : q)) }, at);
      return { added: lines.length };
    },

    plans(jobId) {
      opts.jobs.get(jobId);
      return repo.plans(jobId, (id, err) => opts.logger.warn({ err }, `Prep plan ${id} can't be read, so it's left out.`));
    },

    makePlan(jobId, o) {
      const about = aboutJob(jobId);
      const brief = newest(jobId);
      const input = { ...about, brief: brief ? writerBriefOf(brief) : null };
      return (async () => {
        const { plan, by } = await opts.ai.prepJob(input, {
          signal: o.signal,
          // A new plan for the same job replaces one still being made.
          key: `prep-${jobId}`,
          onQueued: (name) => o.onLine({ kind: 'waiting', by: name }),
          onStart: (name) => o.onLine({ kind: 'working', by: name }),
        });
        const saved = repo.insertPlan(jobId, plan, by, opts.now().toISOString());
        bus.emit('prep.saved', { jobId, planId: saved.id, createdAt: saved.createdAt });
        o.onLine({ kind: 'done', plan: saved });
        return saved;
      })();
    },
  };
}
