// Writes a resume or cover letter from your master profile, streamed as it's
// written. The instructions and your profile come first in the prompt, so
// llama-server can reuse its cache; the job and its ad come last. Only the
// answer is passed on: the model's thinking never reaches a document.

import type { AiSettings } from '../../../../shared/contracts/index.ts';
import { fillPrompt, type Prompt } from '../prompts.ts';
import type { AiProvider } from '../provider.ts';
import { trimAd } from './parse-job.ts';

export type WriteInput = {
  kind: 'resume' | 'cover_letter';
  profile: string;
  guide: string | null;
  // The job's details as plain text: role, company, requirements and so on.
  job: string;
  ad: string;
  // For the cover letter's date, such as "28 October 2026".
  today: string;
};

export async function* writeDocumentTask(o: {
  provider: AiProvider;
  prompt: Prompt;
  config: AiSettings;
  input: WriteInput;
  signal?: AbortSignal;
}): AsyncIterable<string> {
  const task = o.config.tasks.write;
  const values = {
    profile: o.input.profile.trim(),
    guide: o.input.guide?.trim() || 'No guide given.',
    job: o.input.job.trim() || 'No details yet.',
    ad: trimAd(o.input.ad),
    today: o.input.today,
  };
  const stream = o.provider.chatStream(
    {
      messages: [
        { role: 'system', content: fillPrompt(o.prompt.system, values) },
        { role: 'user', content: fillPrompt(o.prompt.user, values) },
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
