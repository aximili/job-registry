// Rates how well a job ad fits your master profile and preferences.
// The profile comes first in the prompt, so llama-server can reuse its cache
// from one rating to the next.

import { Rating, type AiSettings } from '../../../../shared/contracts/index.ts';
import { fillPrompt, type Prompt } from '../prompts.ts';
import type { AiProvider } from '../provider.ts';
import { trimAd } from './parse-job.ts';
import { runJsonTask } from './json-task.ts';

export type RateInput = { profile: string; preferences: string | null; ad: string };

export async function rateJobTask(o: {
  provider: AiProvider;
  prompt: Prompt;
  config: AiSettings;
  input: RateInput;
  signal?: AbortSignal;
}): Promise<Rating> {
  const values = {
    profile: o.input.profile.trim(),
    preferences: o.input.preferences?.trim() || 'None given.',
    ad: trimAd(o.input.ad),
  };
  return runJsonTask({
    provider: o.provider,
    schema: Rating,
    schemaName: 'rating',
    system: fillPrompt(o.prompt.system, values),
    user: fillPrompt(o.prompt.user, values),
    task: o.config.tasks.rate,
    model: o.config.model,
    signal: o.signal,
  });
}
