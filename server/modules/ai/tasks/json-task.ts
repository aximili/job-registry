// The shared shape of every AI task that answers in JSON: send the prompt with
// a schema, read the answer, check it, and give the model one second chance
// with the error before giving up.

import type { z } from 'zod';
import type { TaskSettings } from '../../../../shared/contracts/index.ts';
import { AiAnswerError } from '../../../core/errors.ts';
import { extractJson, toAiSchema } from '../json.ts';
import type { AiProvider, ChatMessage, ChatRequest } from '../provider.ts';

export type JsonTaskOptions<T> = {
  provider: AiProvider;
  schema: z.ZodType<T>;
  schemaName: string;
  system: string;
  user: string;
  task: TaskSettings;
  model: string;
  signal?: AbortSignal;
};

const ERROR_LIMIT = 500;

export async function runJsonTask<T>(o: JsonTaskOptions<T>): Promise<T> {
  const base: Omit<ChatRequest, 'messages'> = {
    model: o.task.model || o.model || undefined,
    temperature: o.task.temperature,
    maxTokens: o.task.maxTokens,
    thinking: o.task.thinking,
    thinkingEffort: o.task.thinkingEffort,
    extra: o.task.extra,
    jsonSchema: { name: o.schemaName, schema: toAiSchema(o.schema) },
  };
  const messages: ChatMessage[] = [
    { role: 'system', content: o.system },
    { role: 'user', content: o.user },
  ];

  const first = await o.provider.chat({ ...base, messages }, { signal: o.signal });
  const checked = check(o.schema, first.text);
  if (checked.ok) return checked.value;

  const retry: ChatMessage[] = [
    ...messages,
    { role: 'assistant', content: first.text || '(an empty answer)' },
    {
      role: 'user',
      content: `That answer was not valid: ${checked.error.slice(0, ERROR_LIMIT)} Reply again with only the JSON object.`,
    },
  ];
  const second = await o.provider.chat({ ...base, messages: retry }, { signal: o.signal });
  const again = check(o.schema, second.text);
  if (again.ok) return again.value;
  throw new AiAnswerError("The AI's answer didn't fit the expected format, even after a second try.");
}

function check<T>(schema: z.ZodType<T>, text: string): { ok: true; value: T } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = extractJson(text);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data };
  const problems = result.error.issues.map((i) => `${i.path.join('.') || 'the answer'}: ${i.message}`);
  return { ok: false, error: `${problems.join('; ')}.` };
}
