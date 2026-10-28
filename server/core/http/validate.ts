import { z } from 'zod';
import { ValidationError } from '../errors.ts';

// Checks a request body, query or params against its shared contract.
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(z.prettifyError(result.error));
  return result.data;
}

export const IdParams = z.object({ id: z.coerce.number().int().positive() });
