// Getting JSON in and out of a language model.

import { z } from 'zod';

// The JSON Schema sent with a request, so the server only lets the model write
// that shape. llama.cpp turns it into a grammar, and long regex patterns (such
// as zod's date pattern) can break that step, so patterns are dropped. "format"
// stays, and zod checks every answer afterwards anyway.
export function toAiSchema(schema: z.ZodType): object {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return strip(json) as object;
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'pattern')
        .map(([key, v]) => [key, strip(v)]),
    );
  }
  return value;
}

// Models sometimes wrap the object in code fences, write some thinking first,
// or add a sentence around it. This finds the object itself.
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1) throw new SyntaxError('The answer had no JSON object in it.');
  if (end < start) throw new SyntaxError('The answer was cut off before the JSON ended.');
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    throw new SyntaxError(`The answer wasn't valid JSON: ${(err as Error).message}`);
  }
}
