import { z } from 'zod';
import { ValidationError } from '../errors.ts';

// Checks a request body, query or params against its shared contract. A
// refusal says what zod says, which quotes what it got. For a body that can
// hold a secret, describe gives a message that doesn't.
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  describe: (error: z.core.$ZodError) => string = z.prettifyError,
): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(describe(result.error));
  return result.data;
}

export const IdParams = z.object({ id: z.coerce.number().int().positive() });
