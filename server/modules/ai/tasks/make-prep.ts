// The prep plan for an interview: what to learn in a day, a practice project,
// likely questions with the story to tell, questions to ask them, and what
// to refresh. Its prompt shares its system part with the other writing tasks.

import { PrepAnswer, type JobNote, type SavedAi, type WriterBrief } from '../../../../shared/contracts/index.ts';
import { briefBlock, capJob, cutPrep, fitRequest, notesBlock } from '../budget.ts';
import type { Prompt } from '../prompts.ts';
import type { AiProvider } from '../provider.ts';
import { runJsonTask } from './json-task.ts';

export type PrepInput = {
  profile: string;
  // The job's details as plain text.
  job: string;
  ad: string;
  // The job's notes, newest first: an interview invite matters most here.
  notes: JobNote[];
  // The job's newest brief, or null when it has none.
  brief: WriterBrief | null;
  today: string;
};

// The request for one AI, fitted to it. Refused when it can't fit.
export function prepRequest(prompt: Prompt, input: PrepInput, ai: SavedAi): { system: string; user: string } {
  const values = {
    profile: input.profile.trim(),
    job: capJob(input.job) || 'No details yet.',
    notes: notesBlock(input.notes),
    brief: briefBlock(input.brief, 'prep'),
    today: input.today,
  };
  return fitRequest(prompt, values, input.ad, ai);
}

export async function makePrepTask(o: {
  provider: AiProvider;
  prompt: Prompt;
  config: SavedAi;
  input: PrepInput;
  signal?: AbortSignal;
}): Promise<PrepAnswer> {
  const { system, user } = prepRequest(o.prompt, o.input, o.config);
  const answer = await runJsonTask({
    provider: o.provider,
    schema: PrepAnswer,
    schemaName: 'prep_plan',
    system,
    user,
    task: o.config.tasks.prep,
    model: o.config.model,
    signal: o.signal,
  });
  return cutPrep(answer);
}
