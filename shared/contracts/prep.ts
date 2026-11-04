import { z } from 'zod';
import { Id, IsoDateTime } from './common.ts';

// Getting ready to write and to interview: the brief you check before the
// AI writes (who to write to, the ad's needs with your stories, the opening
// line, the gaps and the questions), and the prep plan for an interview.
// These are the AI's answers. A long answer is cut, never refused: each list
// is cut to its size before zod checks it, and the JSON Schema sent with the
// request says the size too (maxItems), so llama-server's grammar keeps to
// it. A short list is taken as it is: the schema asks for the least
// (minItems) but zod doesn't check it, because Claude drops minItems, and a
// refused answer costs a second, paid try. Text has no length in the schema
// (a long bounded repeat makes that grammar slow): the ai module cuts it to
// the caps below after the answer.

// How long each part of a brief may be, in characters.
export const BRIEF_CAPS = {
  name: 120,
  email: 120,
  organisation: 120,
  need: 160,
  storyTitle: 80,
  storyText: 320,
  quote: 300,
  quoteWhy: 240,
  mustHave: 160,
  evidence: 240,
  question: 160,
  questionWhy: 160,
  // An answer you type to one of its questions.
  answer: 240,
} as const;

// How many of each, at most: the ad's needs (the AI is asked for at least
// one), each need's other stories, the gaps and the questions.
export const BRIEF_LISTS = { needs: 3, others: 2, gaps: 5, questions: 5 } as const;
// A saved brief's questions: your answered ones from the job's last brief
// first, then the AI's new ones, up to this many in all.
export const BRIEF_QUESTIONS_KEPT = 10;

// A prep plan's text fields, and each step of a topic to learn.
export const PREP_CAPS = { text: 320, step: 200 } as const;
// At most, for each list: a topic's steps are asked for 2 at least.
export const PREP_LISTS = { learn: 5, steps: 4, touches: 6, interview: 6, ask: 5, refresh: 8 } as const;
// The hours a topic or the practice project may take.
export const PREP_HOURS = { min: 0.25, max: 8 } as const;

// A list cut to max items before it's checked. min is only asked for, in
// the JSON Schema: a shorter list is taken as it is.
function upTo<T extends z.ZodType>(item: T, max: number, min = 0) {
  const list = z.array(item).max(max);
  return z.preprocess((v) => (Array.isArray(v) ? v.slice(0, max) : v), min > 0 ? list.meta({ minItems: min }) : list);
}

// Hours kept within the plan's range, so an odd number is fixed, not refused.
const Hours = z.preprocess(
  (v) => (typeof v === 'number' ? Math.min(PREP_HOURS.max, Math.max(PREP_HOURS.min, v)) : v),
  z.number().min(PREP_HOURS.min).max(PREP_HOURS.max),
);

// A story from your profile: the problem, what you did, the result.
export const Story = z.object({ title: z.string(), text: z.string() });
export type Story = z.infer<typeof Story>;

// The AI's brief (schema name "brief"), in the order it writes it.
export const BriefAnswer = z.object({
  // Who to write to. A first name in the email counts as the name.
  contact: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    recruiter: z.boolean(),
    organisation: z.string().nullable(),
  }),
  // The ad's biggest needs, each with the best story, and others to swap in.
  needs: upTo(z.object({ need: z.string(), story: Story, others: upTo(Story, BRIEF_LISTS.others) }), BRIEF_LISTS.needs, 1),
  // The ad's most telling line, word for word, and why it fits you.
  opening: z.object({ quote: z.string(), why: z.string() }),
  // Each must-have you lack, with your nearest real evidence.
  gaps: upTo(z.object({ mustHave: z.string(), evidence: z.string() }), BRIEF_LISTS.gaps),
  // Only where your answer would change the document.
  questions: upTo(z.object({ question: z.string(), why: z.string() }), BRIEF_LISTS.questions),
});
export type BriefAnswer = z.infer<typeof BriefAnswer>;

// The AI's prep plan (schema name "prep_plan").
export const PrepAnswer = z.object({
  // Learn in a day: the must-haves you lack or are weak in, most valuable first.
  learn: upTo(
    z.object({
      topic: z.string(),
      why: z.string(),
      steps: upTo(z.string(), PREP_LISTS.steps, 2),
      hours: Hours,
      // What you can honestly say once it's done.
      afterwards: z.string(),
    }),
    PREP_LISTS.learn,
  ),
  // One project you can build in a day.
  project: z.object({ title: z.string(), what: z.string(), touches: upTo(z.string(), PREP_LISTS.touches), hours: Hours, afterwards: z.string() }),
  // Likely interview questions, each with the story from your profile to tell.
  interview: upTo(z.object({ question: z.string(), story: z.string() }), PREP_LISTS.interview),
  // Questions to ask them, from what the ad leaves open.
  ask: upTo(z.object({ question: z.string(), why: z.string() }), PREP_LISTS.ask),
  // What your profile marks to refresh or confirm that this job touches.
  refresh: upTo(z.object({ item: z.string(), why: z.string() }), PREP_LISTS.refresh),
});
export type PrepAnswer = z.infer<typeof PrepAnswer>;

// The brief you checked, as the writer gets it: the story you chose for each
// need you kept, and the questions you answered. Dropped needs and skipped
// questions never reach it.
export const WriterBrief = z.object({
  contact: BriefAnswer.shape.contact,
  opening: BriefAnswer.shape.opening,
  needs: z.array(z.object({ need: z.string(), story: Story })),
  gaps: z.array(z.object({ mustHave: z.string(), evidence: z.string() })),
  answers: z.array(z.object({ question: z.string(), answer: z.string() })),
});
export type WriterBrief = z.infer<typeof WriterBrief>;

// One of the job's notes, as a writing task gets it. at is an ISO time.
export const JobNote = z.object({ at: z.string(), text: z.string() });
export type JobNote = z.infer<typeof JobNote>;

// A saved brief, as you've edited it. Each need keeps its stories, the best
// first, and which one you chose; a dropped need stays, so you can bring it
// back. A brief with no needs (the AI found none) is kept as it is. Each
// question keeps your answer, whether you skipped it, whether it goes in
// your master profile, and when it was added there (null until it is, and
// again once you change the answer). fromEarlier: an answer you gave in one
// of the job's earlier briefs, carried into this one (a brief saved before
// the mark carries none).
const BriefNeed = z
  .object({ need: z.string(), stories: z.array(Story).min(1), chosen: z.number().int().min(0), dropped: z.boolean() })
  .refine((n) => n.chosen < n.stories.length, { message: 'The chosen story must be one of its stories.', path: ['chosen'] });
const BriefQuestion = z.object({
  question: z.string(),
  why: z.string(),
  answer: z.string().nullable(),
  skipped: z.boolean(),
  addToProfile: z.boolean(),
  addedAt: IsoDateTime.nullable(),
  fromEarlier: z.boolean().default(false),
});

// The brief's own parts: what the prep module keeps as JSON.
export const BriefBody = z.object({
  contact: BriefAnswer.shape.contact,
  // inAd: whether the quote is word for word in the ad.
  opening: z.object({ quote: z.string(), why: z.string(), inAd: z.boolean() }),
  needs: z.array(BriefNeed),
  gaps: z.array(z.object({ mustHave: z.string(), evidence: z.string() })),
  questions: z.array(BriefQuestion),
});
export type BriefBody = z.infer<typeof BriefBody>;

// by is the name of the AI that made it. approvedAt is when a document was
// last written with it.
export const Brief = z.object({
  id: Id,
  jobId: Id,
  by: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  approvedAt: IsoDateTime.nullable(),
  ...BriefBody.shape,
});
export type Brief = z.infer<typeof Brief>;

export const BriefResponse = z.object({ brief: Brief.nullable() });
export type BriefResponse = z.infer<typeof BriefResponse>;

// What you change in a brief. Each list, when sent, has one entry for each
// of the brief's own, in order.
export const BriefEdits = z.strictObject({
  contact: z
    .strictObject({
      name: z.string().trim().max(BRIEF_CAPS.name, `A name can be ${BRIEF_CAPS.name} characters at most.`).nullable(),
      recruiter: z.boolean(),
    })
    .optional(),
  needs: z
    .array(z.strictObject({ chosen: z.number().int().min(0).max(BRIEF_LISTS.others), dropped: z.boolean() }))
    .max(BRIEF_LISTS.needs)
    .optional(),
  questions: z
    .array(
      z.strictObject({
        answer: z.string().trim().max(BRIEF_CAPS.answer, `An answer can be ${BRIEF_CAPS.answer} characters at most.`).nullable(),
        skipped: z.boolean(),
        addToProfile: z.boolean(),
      }),
    )
    .max(BRIEF_QUESTIONS_KEPT)
    .optional(),
});
export type BriefEdits = z.infer<typeof BriefEdits>;

export const AddAnswersResponse = z.object({ added: z.number().int().nonnegative() });
export type AddAnswersResponse = z.infer<typeof AddAnswersResponse>;

// Making a brief streams one of these per line (NDJSON): waiting in the
// queue (by is the writing AI picked), working once the AI has started (by
// is the AI it runs on), then done with the brief, or error with a sentence
// to show. While the AI works quietly, alive every 20 seconds says the reply
// is still there: there's nothing to show for it.
export const BriefLine = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('waiting'), by: z.string() }),
  z.object({ kind: z.literal('working'), by: z.string() }),
  z.object({ kind: z.literal('alive') }),
  z.object({ kind: z.literal('done'), brief: Brief }),
  z.object({ kind: z.literal('error'), message: z.string() }),
]);
export type BriefLine = z.infer<typeof BriefLine>;

// A saved prep plan's own parts: what the prep module keeps as JSON. It's
// the AI's answer once cut, so no list has a least size here: a topic whose
// steps were only links keeps one step, or none. A saved plan always reads.
export const PrepBody = z.object({
  learn: z.array(z.object({ topic: z.string(), why: z.string(), steps: z.array(z.string()), hours: z.number(), afterwards: z.string() })),
  project: z.object({ title: z.string(), what: z.string(), touches: z.array(z.string()), hours: z.number(), afterwards: z.string() }),
  interview: z.array(z.object({ question: z.string(), story: z.string() })),
  ask: z.array(z.object({ question: z.string(), why: z.string() })),
  refresh: z.array(z.object({ item: z.string(), why: z.string() })),
});
export type PrepBody = z.infer<typeof PrepBody>;

// by is the name of the AI that made it.
export const PrepPlan = z.object({ id: Id, jobId: Id, by: z.string().nullable(), createdAt: IsoDateTime, ...PrepBody.shape });
export type PrepPlan = z.infer<typeof PrepPlan>;

// The job's plans, newest first.
export const PrepPlansResponse = z.object({ plans: z.array(PrepPlan) });
export type PrepPlansResponse = z.infer<typeof PrepPlansResponse>;

// Making a plan streams these lines, as making a brief does.
export const PrepLine = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('waiting'), by: z.string() }),
  z.object({ kind: z.literal('working'), by: z.string() }),
  z.object({ kind: z.literal('alive') }),
  z.object({ kind: z.literal('done'), plan: PrepPlan }),
  z.object({ kind: z.literal('error'), message: z.string() }),
]);
export type PrepLine = z.infer<typeof PrepLine>;
