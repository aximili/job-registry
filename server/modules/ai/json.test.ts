import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CardRating, ParsedJob, Rating } from '../../../shared/contracts/index.ts';
import { extractJson, toAiSchema } from './json.ts';

describe('extractJson', () => {
  it('reads plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips code fences, a leading <think> block and prose around the object', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('<think>Let me see {"no":0}</think>\n{"a":2}')).toEqual({ a: 2 });
    expect(extractJson('Here it is: {"a":{"b":3}} Hope that helps.')).toEqual({ a: { b: 3 } });
  });

  it('throws a short message for an answer that was cut short', () => {
    expect(() => extractJson('{"a":')).toThrow(SyntaxError);
    expect(() => extractJson('no json here')).toThrow('The answer had no JSON object in it.');
  });
});

describe('toAiSchema', () => {
  it('has no pattern and no $schema anywhere, so llama.cpp can turn it into a grammar', () => {
    const text = JSON.stringify(toAiSchema(ParsedJob));
    expect(text).not.toContain('"pattern"');
    expect(text).not.toContain('$schema');
    expect(text).toContain('"format":"date"');
  });

  // llama-server writes the fields in the schema's order. A model that gives
  // the score first picks it before weighing anything, and a small one then
  // gives nearly every job the same number.
  it('asks for the reasons before the verdict and the score', () => {
    const order = (schema: z.ZodType) => Object.keys((toAiSchema(schema) as { properties: object }).properties);
    expect(order(Rating)).toEqual(['why', 'whyNot', 'dealBreakers', 'salaryNote', 'verdict', 'score']);
    expect(order(CardRating)).toEqual(['reason', 'verdict', 'score']);
  });
});
