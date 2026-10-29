import { z } from 'zod';
import { Id, IsoDateTime } from './common.ts';
import { JobSummary } from './jobs.ts';

// Reading Gmail over IMAP (Phase 5). Email is off until you turn it on in
// Settings. The app password lives in config/secrets.json, never here.
export const EmailSettings = z.strictObject({
  enabled: z.boolean().default(false),
  // Your Gmail address, which is also the IMAP user name.
  address: z.string().trim().default(''),
  host: z.string().min(1).default('imap.gmail.com'),
  port: z.number().int().min(1).max(65535).default(993),
  mailbox: z.string().min(1).default('INBOX'),
  // At most once a day: a longer wait would overflow the timer.
  pollMinutes: z.number().int().min(5).max(1440).default(10),
  // The first check reads only this many days back.
  firstCheckDays: z.number().int().min(1).max(90).default(14),
  // Emails read per round of a check. A check keeps going, round after round.
  maxPerCheck: z.number().int().min(1).max(500).default(100),
});
export type EmailSettings = z.infer<typeof EmailSettings>;

export const EmailEvent = z.enum(['received', 'rejected', 'interview', 'assessment', 'offer', 'other']);
export type EmailEvent = z.infer<typeof EmailEvent>;

// What the AI reads from one email. The suggested status is worked out by
// plain code (shared/email-status.ts), never by the AI.
export const EmailClassification = z.strictObject({
  event: EmailEvent,
  // One of the candidate jobs' ids, or null.
  jobId: z.number().int().nullable(),
  company: z.string().nullable(),
  role: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});
export type EmailClassification = z.infer<typeof EmailClassification>;

export const SuggestionState = z.enum(['pending', 'confirmed', 'dismissed', 'ignored']);
export type SuggestionState = z.infer<typeof SuggestionState>;

export const EmailSuggestion = z.object({
  id: Id,
  jobId: Id.nullable(),
  job: JobSummary.nullable(),
  fromAddr: z.string(),
  subject: z.string(),
  receivedAt: IsoDateTime,
  event: EmailEvent,
  suggestedStatus: z.string().nullable(),
  confidence: z.number(),
  summary: z.string(),
  company: z.string().nullable(),
  role: z.string().nullable(),
  state: SuggestionState,
  appliedStatus: z.string().nullable(),
  createdAt: IsoDateTime,
  handledAt: IsoDateTime.nullable(),
});
export type EmailSuggestion = z.infer<typeof EmailSuggestion>;

// jobId: the job you picked instead. status: the status to set, or null to
// only add the note. Left out, both keep the suggestion's.
export const ConfirmSuggestionRequest = z.strictObject({
  jobId: Id.optional(),
  status: z.string().min(1).nullable().optional(),
});
export type ConfirmSuggestionRequest = z.infer<typeof ConfirmSuggestionRequest>;

export const EmailStatus = z.object({
  enabled: z.boolean(),
  // An address and an app password are both set.
  configured: z.boolean(),
  checking: z.boolean(),
  lastCheckAt: IsoDateTime.nullable(),
  lastError: z.string().nullable(),
  lastAdded: z.number().int().nullable(),
  pending: z.number().int(),
});
export type EmailStatus = z.infer<typeof EmailStatus>;

export const EmailTestResult = z.object({ ok: z.boolean(), detail: z.string() });
export type EmailTestResult = z.infer<typeof EmailTestResult>;

// Secrets are never sent to the browser: only whether each one is set.
export const SecretsStatus = z.object({ emailPassword: z.boolean() });
export type SecretsStatus = z.infer<typeof SecretsStatus>;

// null or blank removes the password.
export const UpdateSecretsRequest = z.strictObject({ emailPassword: z.string().nullable() });
export type UpdateSecretsRequest = z.infer<typeof UpdateSecretsRequest>;
