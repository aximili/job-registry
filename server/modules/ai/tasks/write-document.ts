// Writes a resume or cover letter from your master profile, streamed as it's
// written. The four writing tasks share the prompt's system part (the rules
// and your profile), so llama-server can reuse its cache from one to the
// next; the task, the job, your notes, the brief, the guide and the ad come
// after, the ad last. Only the answer is passed on: the model's thinking
// never reaches a document.

import type { JobNote, SavedAi, WriterBrief } from '../../../../shared/contracts/index.ts';
import { briefBlock, capJob, fitRequest, notesBlock } from '../budget.ts';
import type { Prompt } from '../prompts.ts';
import type { AiProvider } from '../provider.ts';

export type WriteInput = {
  kind: 'resume' | 'cover_letter';
  profile: string;
  guide: string | null;
  // The job's details as plain text: role, company, requirements and so on.
  job: string;
  ad: string;
  // For the cover letter's date, such as "28 October 2026".
  today: string;
  // The job's notes, newest first. Every one counts.
  notes: JobNote[];
  // The brief you checked, or null for the AI to plan the document itself.
  brief: WriterBrief | null;
};

// The request for one AI, fitted to it. Refused when it can't fit.
export function writeRequest(prompt: Prompt, input: WriteInput, ai: SavedAi): { system: string; user: string } {
  const values = {
    profile: input.profile.trim(),
    guide: input.guide?.trim() || 'No guide given.',
    job: capJob(input.job) || 'No details yet.',
    notes: notesBlock(input.notes),
    brief: briefBlock(input.brief, input.kind),
    today: input.today,
  };
  return fitRequest(prompt, values, input.ad, ai);
}

export async function* writeDocumentTask(o: {
  provider: AiProvider;
  prompt: Prompt;
  config: SavedAi;
  input: WriteInput;
  signal?: AbortSignal;
}): AsyncIterable<string> {
  const task = o.config.tasks.write;
  const { system, user } = writeRequest(o.prompt, o.input, o.config);
  const stream = o.provider.chatStream(
    {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      model: task.model || o.config.model || undefined,
      temperature: task.temperature,
      maxTokens: task.maxTokens,
      thinking: task.thinking,
      thinkingEffort: task.thinkingEffort,
      extra: task.extra,
    },
    { signal: o.signal },
  );
  for await (const chunk of stream) {
    if (chunk.kind === 'text') yield chunk.text;
  }
}
