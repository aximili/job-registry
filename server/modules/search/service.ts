// Instant search for the recruiter-call moment. The index is kept up to date
// by listening to events. It reads current data through the jobs, contacts
// and notes services, never their tables. See docs/architecture.md §7.2.

import type { RebuildSearchResponse, SearchHit, Status } from '../../../shared/contracts/index.ts';
import { queryDigits } from '../../../shared/phone.ts';
import { NotFoundError } from '../../core/errors.ts';
import type { EventBus } from '../../core/events.ts';
import type { ContactsService } from '../contacts/index.ts';
import type { JobsService } from '../jobs/index.ts';
import type { NotesService } from '../notes/index.ts';
import { buildFtsQuery, searchable } from './query.ts';
import type { IndexDoc, IndexKind, SearchRepo } from './repo.ts';

export interface SearchService {
  query(q: string): SearchHit[];
  reindexJob(jobId: number): void;
  reindexContact(contactId: number): void;
  rebuild(): RebuildSearchResponse;
}

export type SearchOptions = {
  repo: SearchRepo;
  bus: EventBus;
  jobs: JobsService;
  contacts: ContactsService;
  notes: NotesService;
  statuses: () => Status[];
};

const MAX_HITS = 20;
// A safety cap. The registry holds a few thousand rows at most.
const MAX_MATCHES = 5000;

const clean = (doc: IndexDoc): IndexDoc => ({
  title: searchable(doc.title),
  people: searchable(doc.people),
  notes: searchable(doc.notes),
  ad: searchable(doc.ad),
});

const join = (parts: (string | null | undefined)[], sep = ' '): string => parts.filter(Boolean).join(sep);

type Ranked = { hit: SearchHit; phone: boolean; closed: boolean; rank: number; updatedAt: string };

export function createSearchService(opts: SearchOptions): SearchService {
  const { repo, jobs, contacts, notes } = opts;

  function reindexJob(jobId: number): void {
    let job;
    try {
      job = jobs.get(jobId);
    } catch (err) {
      if (err instanceof NotFoundError) return repo.remove('job', jobId);
      throw err;
    }
    if (job.archived) return repo.remove('job', jobId);

    const people = contacts.listForJob(jobId);
    repo.upsert('job', jobId, clean({
      title: join([job.company, job.agency, job.title]),
      people: join(people.flatMap((p) => [p.name, p.role, p.organisation, p.email, p.phone])),
      notes: join(
        [
          job.location,
          job.summary,
          ...job.requirements,
          ...notes.listForJob(jobId).map((n) => n.body),
          ...contacts.listInteractionsForJob(jobId).map((i) => i.notes),
        ],
        '\n',
      ),
      ad: join(
        jobs.listPostings(jobId).map((p) => p.jdText),
        '\n\n',
      ),
    }));
  }

  function reindexContact(contactId: number): void {
    let contact;
    try {
      contact = contacts.get(contactId);
    } catch (err) {
      if (err instanceof NotFoundError) return repo.remove('contact', contactId);
      throw err;
    }
    repo.upsert('contact', contactId, clean({
      title: contact.name,
      people: join([contact.role, contact.organisation, contact.email, contact.phone]),
      notes: contact.notes ?? '',
      ad: '',
    }));
  }

  // Keep the index in step with every change that affects what you can find.
  const { bus } = opts;
  for (const name of ['job.saved', 'job.updated', 'job.statusChanged', 'posting.added'] as const) {
    bus.on(name, ({ jobId }) => reindexJob(jobId));
  }
  for (const name of ['note.added', 'note.updated', 'note.removed'] as const) {
    bus.on(name, ({ jobId }) => reindexJob(jobId));
  }
  bus.on('contact.saved', ({ contactId, jobIds }) => {
    reindexContact(contactId);
    for (const id of jobIds) reindexJob(id);
  });
  for (const name of ['contact.linked', 'contact.unlinked'] as const) {
    bus.on(name, ({ contactId, jobId }) => {
      reindexContact(contactId);
      reindexJob(jobId);
    });
  }
  bus.on('interaction.logged', ({ jobId }) => {
    if (jobId !== null) reindexJob(jobId);
  });

  const activeJobIds = (ids: number[]): number[] =>
    ids.length === 0 ? [] : jobs.getSummaries(ids).filter((j) => !j.archived).map((j) => j.id);

  return {
    reindexJob,
    reindexContact,

    query(q) {
      const text = q.trim();
      if (!text) return [];

      // Phone numbers: any part of the digits, through the contacts module.
      const phoneJobs = new Set<number>();
      const phoneContacts = new Set<number>();
      // Numbers copied from Outlook, Teams or a phone app often carry invisible
      // direction marks or full-width digits; clean them first.
      const digits = queryDigits(searchable(text));
      if (digits) {
        for (const match of contacts.findByPhoneDigits(digits)) {
          const shown = activeJobIds(match.jobIds);
          if (shown.length > 0) shown.forEach((id) => phoneJobs.add(id));
          else phoneContacts.add(match.contactId);
        }
      }

      const fts = buildFtsQuery(text);
      const rows = fts ? repo.matches(fts, MAX_MATCHES) : [];
      const jobRows = new Map<number, number>();
      const contactRows = new Map<number, number>();
      for (const row of rows) {
        const target = row.kind === 'job' ? jobRows : contactRows;
        if (!target.has(row.refId)) target.set(row.refId, row.rank);
      }
      for (const id of phoneJobs) if (!jobRows.has(id)) jobRows.set(id, 0);
      for (const id of phoneContacts) if (!contactRows.has(id)) contactRows.set(id, 0);

      const closed = new Set(opts.statuses().filter((s) => s.closed).map((s) => s.id));
      const ranked: Ranked[] = [];

      for (const job of jobs.getSummaries([...jobRows.keys()])) {
        if (job.archived) continue;
        ranked.push({
          hit: {
            kind: 'job',
            jobId: job.id,
            title: job.title,
            company: job.company,
            agency: job.agency,
            status: job.status,
            dateApplied: job.dateApplied,
            snippet: null,
          },
          phone: phoneJobs.has(job.id),
          closed: closed.has(job.status),
          rank: jobRows.get(job.id)!,
          updatedAt: job.updatedAt,
        });
      }

      // A person only shows on their own when none of their jobs shows:
      // otherwise their jobs already do. Archived jobs never show.
      for (const [contactId, rank] of contactRows) {
        if (activeJobIds(contacts.listJobIdsForContact(contactId)).length > 0) continue;
        const contact = contacts.get(contactId);
        ranked.push({
          hit: {
            kind: 'contact',
            contactId,
            name: contact.name,
            organisation: contact.organisation,
            phone: contact.phone,
            snippet: null,
          },
          phone: phoneContacts.has(contactId),
          closed: false,
          rank,
          updatedAt: contact.updatedAt,
        });
      }

      // Phone matches first, then open before closed, then best match, then newest.
      ranked.sort(
        (a, b) =>
          Number(b.phone) - Number(a.phone) ||
          Number(a.closed) - Number(b.closed) ||
          Number(a.hit.kind === 'contact') - Number(b.hit.kind === 'contact') ||
          a.rank - b.rank ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
      const shown = ranked.slice(0, MAX_HITS).map((r) => r.hit);

      // Snippets only for what is shown.
      if (fts && shown.length > 0) {
        const keyOf = (h: SearchHit): { kind: IndexKind; refId: number } =>
          h.kind === 'job' ? { kind: 'job', refId: h.jobId } : { kind: 'contact', refId: h.contactId };
        const snippets = repo.snippets(fts, shown.map(keyOf));
        for (const hit of shown) {
          const { kind, refId } = keyOf(hit);
          hit.snippet = snippets.get(`${kind}:${refId}`) ?? null;
        }
      }
      return shown;
    },

    rebuild() {
      const jobIds = jobs.listIds({ archived: false });
      const contactIds = contacts.listIds();
      repo.transaction(() => {
        repo.clear();
        for (const id of jobIds) reindexJob(id);
        for (const id of contactIds) reindexContact(id);
      });
      return { jobs: jobIds.length, contacts: contactIds.length };
    },
  };
}
