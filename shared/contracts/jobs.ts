import { z } from 'zod';
import { Capture, SourceSite } from './capture.ts';
import { Id, IsoDateTime, LocalDate } from './common.ts';
import { AdContact, EmploymentType, Salary, WorkMode } from './parsed-job.ts';
import { Rating } from './rating.ts';

export const FieldSource = z.enum(['user', 'ad', 'ai']);
export type FieldSource = z.infer<typeof FieldSource>;

export const ParseState = z.enum(['none', 'pending', 'done', 'failed']);
export type ParseState = z.infer<typeof ParseState>;

export const StatusSource = z.enum(['manual', 'extension', 'email']);
export type StatusSource = z.infer<typeof StatusSource>;

// The fields you can edit on a job.
export const EditableJobFields = z.object({
  title: z.string().nullable(),
  company: z.string().nullable(),
  agency: z.string().nullable(),
  location: z.string().nullable(),
  workMode: WorkMode,
  employmentType: EmploymentType,
  salary: Salary,
  closingDate: LocalDate.nullable(),
  summary: z.string().nullable(),
  requirements: z.array(z.string()),
  niceToHave: z.array(z.string()),
  responsibilities: z.array(z.string()),
  dateApplied: LocalDate.nullable(),
});
export type EditableJobFields = z.infer<typeof EditableJobFields>;

export const Job = EditableJobFields.extend({
  id: Id,
  status: z.string(),
  adContact: AdContact.nullable(),
  fieldSources: z.record(z.string(), FieldSource),
  parseState: ParseState,
  parseError: z.string().nullable(),
  matchVerdict: z.string().nullable(),
  matchScore: z.number().int().nullable(),
  match: Rating.nullable(),
  archived: z.boolean(),
  // A follow-up reminder: the day to chase this job, and why.
  followUpOn: LocalDate.nullable().default(null),
  followUpNote: z.string().nullable().default(null),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Job = z.infer<typeof Job>;

export const JobSummary = z.object({
  id: Id,
  title: z.string().nullable(),
  company: z.string().nullable(),
  agency: z.string().nullable(),
  location: z.string().nullable(),
  status: z.string(),
  dateApplied: LocalDate.nullable(),
  archived: z.boolean(),
  followUpOn: LocalDate.nullable().default(null),
  followUpNote: z.string().nullable().default(null),
  updatedAt: IsoDateTime,
});
export type JobSummary = z.infer<typeof JobSummary>;

export const Posting = z.object({
  id: Id,
  jobId: Id,
  canonicalUrl: z.string().nullable(),
  sourceSite: SourceSite,
  externalId: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  jdText: z.string(),
  capturedAt: IsoDateTime,
});
export type Posting = z.infer<typeof Posting>;

export const StatusChange = z.object({
  id: Id,
  jobId: Id,
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  source: StatusSource,
  changedAt: IsoDateTime,
});
export type StatusChange = z.infer<typeof StatusChange>;

export const JobCheckRequest = z.object({
  canonicalUrl: z.string().nullable(),
  sourceSite: SourceSite,
  externalId: z.string().nullable(),
  title: z.string().optional(),
  company: z.string().optional(),
  location: z.string().optional(),
});
export type JobCheckRequest = z.infer<typeof JobCheckRequest>;

export const ExactMatch = z.object({
  jobId: Id,
  title: z.string().nullable(),
  company: z.string().nullable(),
  status: z.string(),
  dateApplied: LocalDate.nullable(),
});
export type ExactMatch = z.infer<typeof ExactMatch>;

export const Candidate = ExactMatch.extend({
  agency: z.string().nullable(),
  location: z.string().nullable(),
  sourceSites: z.array(SourceSite),
  strength: z.enum(['likely', 'possible']),
});
export type Candidate = z.infer<typeof Candidate>;

export const JobCheckResponse = z.object({
  exact: ExactMatch.nullable(),
  candidates: z.array(Candidate),
});
export type JobCheckResponse = z.infer<typeof JobCheckResponse>;

export const SaveDecision = z.union([z.literal('new'), z.object({ linkTo: Id })]);
export type SaveDecision = z.infer<typeof SaveDecision>;

export const SaveJobRequest = z.object({
  capture: Capture,
  fields: EditableJobFields.partial().optional(),
  status: z.string().optional(),
  decision: SaveDecision.optional(),
  source: StatusSource.optional(),
});
export type SaveJobRequest = z.infer<typeof SaveJobRequest>;

export const SaveJobResponse = z.discriminatedUnion('result', [
  z.object({ result: z.literal('created'), job: Job }),
  z.object({ result: z.literal('linked'), job: Job }),
  z.object({ result: z.literal('exists'), job: Job }),
  z.object({ result: z.literal('needs_decision'), candidates: z.array(Candidate) }),
]);
export type SaveJobResponse = z.infer<typeof SaveJobResponse>;

export const UpdateJobRequest = EditableJobFields.partial().extend({
  archived: z.boolean().optional(),
});
export type UpdateJobRequest = z.infer<typeof UpdateJobRequest>;

export const ChangeStatusRequest = z.object({ status: z.string().min(1) });
export type ChangeStatusRequest = z.infer<typeof ChangeStatusRequest>;

// status is 'open', 'closed', 'all', or a comma-separated list of status ids.
export const ListJobsQuery = z.object({
  status: z.string().min(1).default('open'),
  archived: z.union([z.boolean(), z.stringbool()]).default(false),
  sort: z.enum(['updated', 'applied', 'company']).default('updated'),
});
export type ListJobsQuery = z.infer<typeof ListJobsQuery>;

export const AddPostingRequest = z.object({ capture: Capture });
export type AddPostingRequest = z.infer<typeof AddPostingRequest>;

export const PostingLookupResponse = z.object({ match: ExactMatch.nullable() });
export type PostingLookupResponse = z.infer<typeof PostingLookupResponse>;

// on: null clears the follow-up, and its reason with it.
export const SetFollowUpRequest = z.strictObject({
  on: LocalDate.nullable(),
  note: z.string().trim().max(200, 'Keep the reason to 200 characters or fewer.').nullable().optional(),
});
export type SetFollowUpRequest = z.infer<typeof SetFollowUpRequest>;

// due: today or late, oldest first. soon: the next 7 days, soonest first.
export const FollowUpsResponse = z.object({ today: LocalDate, due: z.array(JobSummary), soon: z.array(JobSummary) });
export type FollowUpsResponse = z.infer<typeof FollowUpsResponse>;
