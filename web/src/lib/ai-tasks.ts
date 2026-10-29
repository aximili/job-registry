// Settings → AI → "How the AI works on each task": one row per AI task, and
// how each row maps to that task's block in settings.json (ai.tasks.*).
// A row leaves out the extra request fields: they stay as they are.

import type { AiSettings, TaskSettings } from '../../../shared/contracts/index.ts';

export type TaskKey = keyof AiSettings['tasks'];
export type Thinking = 'off' | 'low' | 'medium' | 'high';

export const TASK_ROWS: { key: TaskKey; label: string }[] = [
  { key: 'parse', label: 'Reading job ads' },
  { key: 'rate', label: 'Rating a job' },
  { key: 'card', label: 'Quick marks on search lists' },
  { key: 'write', label: 'Writing resumes and cover letters' },
  { key: 'email', label: 'Reading emails' },
];

export const THINKING: { value: Thinking; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

// "High" is the strongest effort the server knows: xhigh.
export function thinkingOf(t: TaskSettings): Thinking {
  if (!t.thinking) return 'off';
  return t.thinkingEffort === 'xhigh' ? 'high' : t.thinkingEffort;
}

// Off keeps the effort, so turning thinking on again picks up where it was.
export function withThinking(t: TaskSettings, v: Thinking): TaskSettings {
  if (v === 'off') return { ...t, thinking: false };
  return { ...t, thinking: true, thinkingEffort: v === 'high' ? 'xhigh' : v };
}

// A row as it is on screen. A number box gives null when it's empty or
// holds something that isn't a number.
export type TaskRow = { thinking: Thinking; maxTokens: number | null; temperature: number | null; model: string };

export function rowOf(t: TaskSettings): TaskRow {
  return { thinking: thinkingOf(t), maxTokens: t.maxTokens, temperature: t.temperature, model: t.model ?? '' };
}

// What to fix in a row before it can be saved, or null when it's fine.
export function rowProblem(label: string, row: TaskRow): string | null {
  const tokens = row.maxTokens;
  if (typeof tokens !== 'number' || !Number.isInteger(tokens) || tokens < 16) {
    return `${label}: the longest answer must be a whole number, 16 or more.`;
  }
  const temperature = row.temperature;
  if (typeof temperature !== 'number' || !(temperature >= 0 && temperature <= 2)) {
    return `${label}: the temperature must be a number from 0 to 2.`;
  }
  return null;
}

// The row back into the task's settings. An empty Model means the same
// model as the AI section above (null in settings.json).
export function fromRow(t: TaskSettings, row: TaskRow): TaskSettings {
  return {
    ...withThinking(t, row.thinking),
    maxTokens: Number(row.maxTokens),
    temperature: Number(row.temperature),
    model: row.model.trim() || null,
  };
}
