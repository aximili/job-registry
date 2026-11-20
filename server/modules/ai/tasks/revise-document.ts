// Rewrites a saved or unsaved resume or cover letter from a note. The prompt's
// system part stays word for word the same as the writing prompts, so the AI
// can reuse its cache. The note, current draft, job, notes, brief, guide and
// ad go in the user part, with the ad last.

import type { JobNote, SavedAi, WriterBrief } from '../../../../shared/contracts/index.ts';
import { briefBlock, capJob, capNote, fitRequest, notesBlock } from '../budget.ts';
import type { Prompt } from '../prompts.ts';
import type { AiProvider } from '../provider.ts';

export type ReviseInput = {
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
  // The job's newest brief, without marking it approved.
  brief: WriterBrief | null;
  // What the user wants changed.
  note: string;
  // The editor's current text.
  draft: string;
};

export function reviseRequest(prompt: Prompt, input: ReviseInput, ai: SavedAi): { system: string; user: string } {
  const values = {
    profile: input.profile.trim(),
    guide: input.guide?.trim() || 'No guide given.',
    job: capJob(input.job) || 'No details yet.',
    notes: notesBlock(input.notes),
    brief: briefBlock(input.brief, input.kind),
    note: capNote(input.note),
    draft: input.draft.trim(),
    today: input.today,
  };
  return fitRequest(prompt, values, input.ad, ai);
}

export async function* reviseDocumentTask(o: {
  provider: AiProvider;
  prompt: Prompt;
  config: SavedAi;
  input: ReviseInput;
  signal?: AbortSignal;
}): AsyncIterable<string> {
  const task = o.config.tasks.write;
  const { system, user } = reviseRequest(o.prompt, o.input, o.config);
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
