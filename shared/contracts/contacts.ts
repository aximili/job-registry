import { z } from 'zod';
import { Id, IsoDateTime } from './common.ts';

export const Relation = z.enum(['recruiter', 'hiring_manager', 'referrer', 'other']);
export type Relation = z.infer<typeof Relation>;

export const Contact = z.object({
  id: Id,
  name: z.string(),
  role: z.string().nullable(),
  organisation: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Contact = z.infer<typeof Contact>;

const optionalText = z.string().nullable().optional();

export const CreateContactRequest = z.object({
  name: z.string().trim().min(1, 'A person needs a name.'),
  role: optionalText,
  organisation: optionalText,
  email: optionalText,
  phone: optionalText,
  linkedinUrl: optionalText,
  notes: optionalText,
});
export type CreateContactRequest = z.infer<typeof CreateContactRequest>;

export const UpdateContactRequest = CreateContactRequest.partial();
export type UpdateContactRequest = z.infer<typeof UpdateContactRequest>;

export const JobContact = Contact.extend({
  relation: Relation,
  lastInteractionAt: IsoDateTime.nullable(),
});
export type JobContact = z.infer<typeof JobContact>;

export const LinkContactRequest = z.object({
  contactId: Id,
  relation: Relation.default('recruiter'),
});
export type LinkContactRequest = z.infer<typeof LinkContactRequest>;

export const InteractionKind = z.enum(['call', 'email', 'meeting', 'message']);
export type InteractionKind = z.infer<typeof InteractionKind>;

export const Interaction = z.object({
  id: Id,
  contactId: Id.nullable(),
  contactName: z.string().nullable(),
  jobId: Id.nullable(),
  kind: InteractionKind,
  happenedAt: IsoDateTime,
  notes: z.string(),
});
export type Interaction = z.infer<typeof Interaction>;

// Pick an existing person (contactId) or create one on the spot (newContact).
export const LogInteractionRequest = z.object({
  contactId: Id.nullable().optional(),
  newContact: CreateContactRequest.optional(),
  jobId: Id.nullable().optional(),
  kind: InteractionKind.default('call'),
  happenedAt: IsoDateTime.optional(),
  notes: z.string().default(''),
});
export type LogInteractionRequest = z.infer<typeof LogInteractionRequest>;
