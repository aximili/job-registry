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

// updatedAt: the file's time when the editor loaded it (null for a missing
// file). When it's given and the file has changed since (answers added to it,
// a new starter guide), the save is refused, so it can't undo that change.
// Left out, the file is saved as it is.
export const PutProfileRequest = z.strictObject({
  text: z.string().max(200_000, 'That file is too long.'),
  updatedAt: IsoDateTime.nullable().optional(),
});
export type PutProfileRequest = z.infer<typeof PutProfileRequest>;

// The two writing guides, which the app ships starters for and keeps up to date.
export const GuideName = z.enum(['resume-guide', 'cover-letter-guide']);
export type GuideName = z.infer<typeof GuideName>;

// One line of a line-by-line diff (shared/line-diff.ts).
export const DiffLine = z.object({ kind: z.enum(['same', 'removed', 'added']), text: z.string() });
export type DiffLine = z.infer<typeof DiffLine>;

// Your guide against the app's starter guide:
// same: they're the same; newer: a newer starter is ready (with the diff from
// your guide to it); yours: they differ, and you chose to keep yours.
export const StarterStatus = z.object({
  name: GuideName,
  state: z.enum(['same', 'newer', 'yours']),
  diff: z.array(DiffLine).nullable(),
});
export type StarterStatus = z.infer<typeof StarterStatus>;

// Use the new guide (your old one is kept in profile/old-versions), or keep yours.
export const StarterAction = z.enum(['use', 'keep']);
export type StarterAction = z.infer<typeof StarterAction>;
export const StarterActionRequest = z.strictObject({ action: StarterAction });
export type StarterActionRequest = z.infer<typeof StarterActionRequest>;
