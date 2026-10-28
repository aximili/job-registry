// Reads a job ad into the fields of a job.

import { ParsedJob, type AiSettings } from '../../../../shared/contracts/index.ts';
import { localDate } from '../../../../shared/dates.ts';
import { fillPrompt, type Prompt } from '../prompts.ts';
import type { AiProvider } from '../provider.ts';
import { runJsonTask } from './json-task.ts';

export const AD_LIMIT = 12_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The AI gets at most 12,000 characters of the ad. The saved ad is never cut.
export function trimAd(text: string): string {
  const ad = text.trim();
  return ad.length > AD_LIMIT ? `${ad.slice(0, AD_LIMIT)}\n[The rest of the ad was cut.]` : ad;
}

export async function parseJobTask(o: {
  provider: AiProvider;
  prompt: Prompt;
  config: AiSettings;
  adText: string;
  today: Date;
  signal?: AbortSignal;
}): Promise<ParsedJob> {
  const d = o.today;
  const values = { today: `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} (${localDate(d)})`, ad: trimAd(o.adText) };
  const parsed = await runJsonTask({
    provider: o.provider,
    schema: ParsedJob,
    schemaName: 'parsed_job',
    system: fillPrompt(o.prompt.system, values),
    user: fillPrompt(o.prompt.user, values),
    task: o.config.tasks.parse,
    model: o.config.model,
    signal: o.signal,
  });
  return tidy(parsed);
}

const text = (v: string | null): string | null => (v && v.trim() ? v.trim() : null);
const list = (items: string[]): string[] => items.map((i) => i.trim()).filter(Boolean);

function tidy(p: ParsedJob): ParsedJob {
  return {
    ...p,
    title: text(p.title),
    company: text(p.company),
    agency: text(p.agency),
    location: text(p.location),
    summary: p.summary.trim(),
    requirements: list(p.requirements),
    niceToHave: list(p.niceToHave),
    responsibilities: list(p.responsibilities),
    salary: { ...p.salary, text: text(p.salary.text), currency: text(p.salary.currency) },
  };
}
