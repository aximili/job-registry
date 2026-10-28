// People (recruiters, hiring managers, referrers), the jobs they're linked to,
// and the log of every call, email and meeting with them.

import type {
  Contact,
  CreateContactRequest,
  Interaction,
  JobContact,
  LinkContactRequest,
  LogInteractionRequest,
  UpdateContactRequest,
} from '../../../shared/contracts/index.ts';
import { phoneDigits, queryDigits } from '../../../shared/phone.ts';
import type { Clock } from '../../core/config.ts';
import { NotFoundError } from '../../core/errors.ts';
import type { EventBus } from '../../core/events.ts';
import type { ContactFields, ContactsRepo } from './repo.ts';

export interface ContactsService {
  create(req: CreateContactRequest): Contact;
  update(id: number, patch: UpdateContactRequest): Contact;
  get(id: number): Contact;
  list(q?: string): Contact[];
  listIds(): number[];
  linkToJob(jobId: number, req: LinkContactRequest): JobContact;
  unlink(jobId: number, contactId: number): void;
  listForJob(jobId: number): JobContact[];
  listJobIdsForContact(contactId: number): number[];
  findByPhoneDigits(digits: string): { contactId: number; jobIds: number[] }[];
  logInteraction(req: LogInteractionRequest): Interaction;
  listInteractionsForJob(jobId: number): Interaction[];
}

const LIST_LIMIT = 20;

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function toFields(req: CreateContactRequest): ContactFields {
  return {
    name: req.name.trim(),
    role: text(req.role),
    organisation: text(req.organisation),
    email: text(req.email),
    phone: text(req.phone),
    phoneDigits: phoneDigits(req.phone ?? ''),
    linkedinUrl: text(req.linkedinUrl),
    notes: text(req.notes),
  };
}

export function createContactsService(opts: { repo: ContactsRepo; bus: EventBus; now: Clock }): ContactsService {
  const { repo, bus } = opts;

  function get(id: number): Contact {
    const contact = repo.getContact(id);
    if (!contact) throw new NotFoundError(`Contact ${id} not found`);
    return contact;
  }

  return {
    create(req) {
      const id = repo.insertContact(toFields(req), opts.now().toISOString());
      bus.emit('contact.saved', { contactId: id, jobIds: [] });
      return get(id);
    },

    update(id, patch) {
      get(id);
      const fields: Partial<ContactFields> = {};
      if (patch.name !== undefined) fields.name = patch.name.trim();
      for (const key of ['role', 'organisation', 'email', 'linkedinUrl', 'notes'] as const) {
        if (patch[key] !== undefined) fields[key] = text(patch[key]);
      }
      if (patch.phone !== undefined) {
        fields.phone = text(patch.phone);
        fields.phoneDigits = phoneDigits(patch.phone ?? '');
      }
      repo.updateContact(id, fields, opts.now().toISOString());
      bus.emit('contact.saved', { contactId: id, jobIds: repo.listJobIds(id) });
      return get(id);
    },

    get,

    list(q) {
      const query = q?.trim() || null;
      return repo.search(query, query ? queryDigits(query) : null, LIST_LIMIT);
    },

    listIds: () => repo.listIds(),

    linkToJob(jobId, req) {
      get(req.contactId);
      repo.forJob(jobId, () => repo.link(jobId, req.contactId, req.relation));
      bus.emit('contact.linked', { contactId: req.contactId, jobId });
      return repo.listForJob(jobId).find((c) => c.id === req.contactId)!;
    },

    unlink(jobId, contactId) {
      repo.unlink(jobId, contactId);
      bus.emit('contact.unlinked', { contactId, jobId });
    },

    listForJob: (jobId) => repo.listForJob(jobId),
    listJobIdsForContact: (contactId) => repo.listJobIds(contactId),
    findByPhoneDigits: (digits) => repo.findByPhoneDigits(digits),

    // Pick a person or create one, link them to the job, and log the call,
    // all in one go: the recruiter is still on the phone.
    logInteraction(req) {
      const at = opts.now().toISOString();
      const jobId = req.jobId ?? null;
      let createdContact: number | null = null;
      let newLink = false;

      const id = repo.transaction(() => {
        let contactId = req.contactId ?? null;
        if (req.newContact) {
          contactId = repo.insertContact(toFields(req.newContact), at);
          createdContact = contactId;
        } else if (contactId !== null) {
          get(contactId);
        }
        const insert = () =>
          repo.insertInteraction({ contactId, jobId, kind: req.kind, happenedAt: req.happenedAt ?? at, notes: req.notes.trim() });
        if (jobId === null) return insert();
        return repo.forJob(jobId, () => {
          if (contactId !== null) newLink = repo.ensureLink(jobId, contactId, 'recruiter');
          return insert();
        });
      });

      const interaction = repo.getInteraction(id)!;
      if (createdContact !== null) bus.emit('contact.saved', { contactId: createdContact, jobIds: jobId ? [jobId] : [] });
      if (newLink && interaction.contactId !== null && jobId !== null) {
        bus.emit('contact.linked', { contactId: interaction.contactId, jobId });
      }
      bus.emit('interaction.logged', { interactionId: id, contactId: interaction.contactId, jobId });
      return interaction;
    },

    listInteractionsForJob: (jobId) => repo.listInteractionsForJob(jobId),
  };
}
