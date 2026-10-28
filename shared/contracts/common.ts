import { z } from 'zod';

export const Id = z.number().int().positive();
export type Id = z.infer<typeof Id>;

// Stored timestamps are ISO 8601 in UTC, as made by Date#toISOString().
export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

// A calendar date with no time, YYYY-MM-DD.
export const LocalDate = z.iso.date();
export type LocalDate = z.infer<typeof LocalDate>;

export const ErrorCode = z.enum(['validation', 'not_found', 'conflict', 'forbidden', 'ai_unavailable', 'internal']);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorBody = z.object({
  error: z.object({ code: ErrorCode, message: z.string() }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;
