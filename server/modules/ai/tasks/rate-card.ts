// A quick rating for one job card in a search list, from what the card shows.
// Its prompt shares its system part (the profile and preferences) with
// rate-job.md, and the values below are filled the same way as rateJobTask's.
// So llama-server can reuse its cache between full ratings and quick ones.

import { CardRating, type AiSettings } from '../../../../shared/contracts/index.ts';
import { fillPrompt, type Prompt } from '../prompts.ts';
import type { AiProvider } from '../provider.ts';
import { runJsonTask } from './json-task.ts';

export type CardInput = { profile: string; preferences: string | null; card: string };

export async function rateCardTask(o: {
  provider: AiProvider;
  prompt: Prompt;
  config: AiSettings;
  input: CardInput;
  signal?: AbortSignal;
}): Promise<CardRating> {
  const values = {
    profile: o.input.profile.trim(),
    preferences: o.input.preferences?.trim() || 'None given.',
    // A card is short, so it's never trimmed like an ad.
    card: o.input.card.trim(),
  };
  return runJsonTask({
    provider: o.provider,
    schema: CardRating,
    schemaName: 'card_rating',
    system: fillPrompt(o.prompt.system, values),
    user: fillPrompt(o.prompt.user, values),
    task: o.config.tasks.card,
    model: o.config.model,
    signal: o.signal,
  });
}
