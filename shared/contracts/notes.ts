import { z } from 'zod';
import { Id, IsoDateTime } from './common.ts';

export const Note = z.object({
  id: Id,
  jobId: Id,
  body: z.string(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Note = z.infer<typeof Note>;

export const NoteBodyRequest = z.object({ body: z.string() });
export type NoteBodyRequest = z.infer<typeof NoteBodyRequest>;
