import { z } from 'zod';
import { IsoDateTime } from './common.ts';

// Your profile files (Markdown, in profile/) and document templates (CSS, in templates/).
export const ProfileFileName = z.enum(['master-profile', 'preferences', 'resume-guide', 'cover-letter-guide', 'resume', 'cover-letter']);
export type ProfileFileName = z.infer<typeof ProfileFileName>;

// A missing file reads as empty text with no date.
export const ProfileFile = z.object({
  name: ProfileFileName,
  text: z.string(),
  updatedAt: IsoDateTime.nullable(),
});
export type ProfileFile = z.infer<typeof ProfileFile>;

export const PutProfileRequest = z.strictObject({ text: z.string().max(200_000, 'That file is too long.') });
export type PutProfileRequest = z.infer<typeof PutProfileRequest>;
