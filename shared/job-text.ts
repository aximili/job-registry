// What the writing tasks (the brief, the prep plan and the documents) get
// about a job: its details as plain text, and its notes. The ai module caps
// and fits both.

import type { Job, JobNote, Note } from './contracts/index.ts';

const WORK_MODE: Record<Job['workMode'], string | null> = { onsite: 'On site', hybrid: 'Hybrid', remote: 'Remote', unknown: null };

// The job's details, leaving out what isn't known. The ad's contact comes
// before the long lists, so a cut to the job's cap never loses it.
export function describeJob(job: Job): string {
  const list = (label: string, items: string[]) => (items.length > 0 ? [`${label}:`, ...items.map((i) => `- ${i}`)] : []);
  const { name, email, phone } = job.adContact ?? { name: null, email: null, phone: null };
  const contact = [name, email, phone].map((part) => part?.trim()).filter(Boolean).join(', ');
  return [
    job.title && `Role: ${job.title}`,
    job.company && `Company: ${job.company}`,
    job.agency && `Recruiter: ${job.agency}`,
    contact && `Contact: ${contact}`,
    job.location && `Location: ${job.location}`,
    WORK_MODE[job.workMode] && `Work mode: ${WORK_MODE[job.workMode]}`,
    job.summary && `Summary: ${job.summary}`,
    ...list('Requirements', job.requirements),
    ...list('Nice to have', job.niceToHave),
    ...list('Responsibilities', job.responsibilities),
  ]
    .filter(Boolean)
    .join('\n');
}

// The job's notes, in the order given (the notes module gives them newest
// first). Every note counts, the email reader's too.
export function jobNotes(notes: Note[]): JobNote[] {
  return notes.map((note) => ({ at: note.createdAt, text: note.body }));
}
