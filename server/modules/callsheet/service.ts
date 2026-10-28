// The one-screen view for a recruiter call. It owns no data: it gathers
// what the jobs, contacts, notes and documents modules already know, in one
// request.

import type { CallSheet } from '../../../shared/contracts/index.ts';
import type { ContactsService } from '../contacts/index.ts';
import type { DocumentsService } from '../documents/index.ts';
import type { JobsService } from '../jobs/index.ts';
import type { NotesService } from '../notes/index.ts';

export interface CallsheetService {
  get(jobId: number): CallSheet;
}

export type CallsheetOptions = { jobs: JobsService; contacts: ContactsService; notes: NotesService; documents: DocumentsService };

export function createCallsheetService({ jobs, contacts, notes, documents }: CallsheetOptions): CallsheetService {
  return {
    get(jobId) {
      const job = jobs.get(jobId);
      return {
        job,
        postings: jobs.listPostings(jobId),
        history: jobs.listHistory(jobId),
        people: contacts.listForJob(jobId),
        notes: notes.listForJob(jobId),
        interactions: contacts.listInteractionsForJob(jobId),
        documents: documents.list(jobId),
        attachments: documents.listAttachments(jobId),
        sent: documents.latestSent(jobId),
      };
    },
  };
}
