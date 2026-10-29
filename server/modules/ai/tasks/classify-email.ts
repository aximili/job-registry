// Reads one email and says what it means: received, rejected, an interview,
// an assessment, an offer, or something else. It knows nothing about jobs
// beyond the short list it's given, and may only pick from that list.

import { EmailClassification, type AiSettings } from '../../../../shared/contracts/index.ts';
import { fillPrompt, type Prompt } from '../prompts.ts';
import type { AiProvider } from '../provider.ts';
import { runJsonTask } from './json-task.ts';

export type ClassifyInput = {
  from: string;
  subject: string;
  receivedAt: string;
  text: string;
  // status is the status's label, as you'd read it.
  candidates: { id: number; title: string | null; company: string | null; agency: string | null; status: string }[];
};

const SUMMARY_LIMIT = 200;
// A company or job title is short; anything longer is email text, which is never kept.
const NAME_LIMIT = 120;

function describe(c: ClassifyInput['candidates'][number]): string {
  const title = c.title?.trim() || 'Untitled role';
  const at = c.company?.trim() ? ` at ${c.company.trim()}` : '';
  const through = c.agency?.trim() ? `, through ${c.agency.trim()}` : '';
  return `[${c.id}] ${title}${at}${through} (${c.status})`;
}

const text = (v: string | null): string | null => (v && v.trim() ? v.trim().slice(0, NAME_LIMIT) : null);

export async function classifyEmailTask(o: {
  provider: AiProvider;
  prompt: Prompt;
  config: AiSettings;
  input: ClassifyInput;
  signal?: AbortSignal;
}): Promise<EmailClassification> {
  const { input } = o;
  const values = {
    candidates: input.candidates.length > 0 ? input.candidates.map(describe).join('\n') : 'None.',
    from: input.from,
    subject: input.subject,
    date: input.receivedAt,
    email: input.text.trim(),
  };
  const answer = await runJsonTask({
    provider: o.provider,
    schema: EmailClassification,
    schemaName: 'email_classification',
    system: fillPrompt(o.prompt.system, values),
    user: fillPrompt(o.prompt.user, values),
    task: o.config.tasks.email,
    model: o.config.model,
    signal: o.signal,
  });
  return {
    ...answer,
    // Only a job it was shown: an email can't point the app at another one.
    jobId: input.candidates.some((c) => c.id === answer.jobId) ? answer.jobId : null,
    company: text(answer.company),
    role: text(answer.role),
    summary: answer.summary.trim().slice(0, SUMMARY_LIMIT),
  };
}
