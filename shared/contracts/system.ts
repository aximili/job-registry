import { z } from 'zod';

export const Health = z.object({
  ok: z.literal(true),
  version: z.string(),
  uptimeSec: z.number(),
});
export type Health = z.infer<typeof Health>;

export const BackupResponse = z.object({ file: z.string() });
export type BackupResponse = z.infer<typeof BackupResponse>;
