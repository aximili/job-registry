// The brief you check before the AI writes a cover letter or resume: who to
// write to, the ad's biggest needs with your best story for each, the
// opening line, your gaps, and the questions whose answers would change the
// document. Its prompt shares its system part with the other writing tasks.

import { BriefAnswer, type JobNote, type SavedAi } from '../../../../shared/contracts/index.ts';
import { answersBlock, capJob, cutBrief, fitRequest, notesBlock, type CutBrief } from '../budget.ts';
import type { Prompt } from '../prompts.ts';
import type { AiProvider } from '../provider.ts';
import { runJsonTask } from './json-task.ts';

export type BriefInput = {
  profile: string;
  // The job's details as plain text.
  job: string;
  ad: string;
  // The job's notes, newest first.
  notes: JobNote[];
  // Your answers in the job's last brief, so this one doesn't ask again.
  // Newest first: past the cap, the first ones are kept.
  answers: { question: string; answer: string }[];
  today: string;
};

// The request for one AI, fitted to it. Refused when it can't fit.
export function briefRequest(prompt: Prompt, input: BriefInput, ai: SavedAi): { system: string; user: string } {
  const values = {
    profile: input.profile.trim(),
    job: capJob(input.job) || 'No details yet.',
    notes: notesBlock(input.notes),
    answers: answersBlock(input.answers),
    today: input.today,
  };
  return fitRequest(prompt, values, input.ad, ai);
}

export async function makeBriefTask(o: {
  provider: AiProvider;
  prompt: Prompt;
  config: SavedAi;
  input: BriefInput;
  signal?: AbortSignal;
}): Promise<CutBrief> {
  const { system, user } = briefRequest(o.prompt, o.input, o.config);
  const answer = await runJsonTask({
    provider: o.provider,
    schema: BriefAnswer,
    schemaName: 'brief',
    system,
    user,
    task: o.config.tasks.brief,
    model: o.config.model,
    signal: o.signal,
  });
  // The quote is checked against the whole ad, as you see it.
  return cutBrief(answer, o.input.ad);
}
