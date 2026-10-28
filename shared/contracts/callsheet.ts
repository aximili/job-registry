import { z } from 'zod';
import { Interaction, JobContact } from './contacts.ts';
import { Attachment, DocumentSummary, SentDocuments } from './documents.ts';
import { Job, Posting, StatusChange } from './jobs.ts';
import { Note } from './notes.ts';

// Everything the one-screen call sheet needs. Lists are newest first.
export const CallSheet = z.object({
  job: Job,
  postings: z.array(Posting),
  history: z.array(StatusChange),
  people: z.array(JobContact),
  notes: z.array(Note),
  interactions: z.array(Interaction),
  // Resumes and cover letters, newest first, and what was sent ("what did I send them?").
  documents: z.array(DocumentSummary),
  attachments: z.array(Attachment),
  sent: SentDocuments,
});
export type CallSheet = z.infer<typeof CallSheet>;
