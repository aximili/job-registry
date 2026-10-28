import { z } from 'zod';

export const Status = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/, 'A status id may only use a–z, 0–9 and _.'),
  label: z.string().trim().min(1, 'A status needs a label.'),
  closed: z.boolean(),
  order: z.number().int(),
  setsAppliedDate: z.boolean(),
});
export type Status = z.infer<typeof Status>;

export const DEFAULT_STATUSES: readonly Status[] = [
  { id: 'saved', label: 'Saved', closed: false, order: 10, setsAppliedDate: false },
  { id: 'applied', label: 'Applied', closed: false, order: 20, setsAppliedDate: true },
  { id: 'screening', label: 'Screening', closed: false, order: 30, setsAppliedDate: false },
  { id: 'interview_1', label: 'Interview 1', closed: false, order: 40, setsAppliedDate: false },
  { id: 'interview_2', label: 'Interview 2', closed: false, order: 50, setsAppliedDate: false },
  { id: 'final_interview', label: 'Final interview', closed: false, order: 60, setsAppliedDate: false },
  { id: 'offer', label: 'Offer', closed: false, order: 70, setsAppliedDate: false },
  { id: 'accepted', label: 'Accepted', closed: false, order: 80, setsAppliedDate: false },
  { id: 'rejected', label: 'Rejected', closed: true, order: 90, setsAppliedDate: false },
  { id: 'withdrawn', label: 'Withdrawn', closed: true, order: 100, setsAppliedDate: false },
  { id: 'no_response', label: 'No response', closed: true, order: 110, setsAppliedDate: false },
];

// These words already mean a group of statuses in job lists (?status=open).
export const RESERVED_STATUS_IDS: readonly string[] = ['open', 'closed', 'all'];

const StatusList = z
  .array(Status)
  .min(1, 'There must be at least one status.')
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    for (const status of list) {
      if (seen.has(status.id)) {
        ctx.addIssue({ code: 'custom', message: `Status id '${status.id}' is used twice.` });
      }
      if (RESERVED_STATUS_IDS.includes(status.id)) {
        ctx.addIssue({ code: 'custom', message: `Status id '${status.id}' is reserved.` });
      }
      seen.add(status.id);
    }
  });

const ServerSettings = z.strictObject({
  port: z.number().int().min(1).max(65535).default(4777),
});

const BackupSettings = z.strictObject({
  dir: z.string().min(1).default('data/backups'),
  keep: z.number().int().min(1).default(14),
});

// Every section has defaults, so an empty or partial file still works.
// Unknown keys are refused, so a typo like "backup" for "backups" is caught
// instead of being silently ignored.
export const Settings = z.strictObject({
  server: ServerSettings.prefault({}),
  backups: BackupSettings.prefault({}),
  statuses: StatusList.default(() => DEFAULT_STATUSES.map((s) => ({ ...s }))),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = Settings.parse({});

// A patch replaces each top-level section it contains.
export const UpdateSettingsRequest = z.strictObject({
  server: ServerSettings.optional(),
  backups: BackupSettings.optional(),
  statuses: StatusList.optional(),
});
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>;
