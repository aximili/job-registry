import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type TaskSettings } from '../../../shared/contracts/index.ts';
import { fromRow, rowOf, rowProblem, TASK_ROWS, THINKING, thinkingOf, withThinking, type TaskRow, type Thinking } from './ai-tasks.ts';

const task = (t: Partial<TaskSettings> = {}): TaskSettings => ({ ...DEFAULT_SETTINGS.ai.tasks.rate, ...t });

describe('the AI task rows in Settings', () => {
  it('has one row per task, in this order, with these names', () => {
    expect(TASK_ROWS).toEqual([
      { key: 'parse', label: 'Reading job ads' },
      { key: 'rate', label: 'Rating a job' },
      { key: 'card', label: 'Quick marks on search lists' },
      { key: 'write', label: 'Writing resumes and cover letters' },
      { key: 'email', label: 'Reading emails' },
    ]);
    // Every task in settings.json has a row.
    expect(TASK_ROWS.map((r) => r.key).sort()).toEqual(Object.keys(DEFAULT_SETTINGS.ai.tasks).sort());
  });

  it('offers thinking Off, Low, Medium and High', () => {
    expect(THINKING).toEqual([
      { value: 'off', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ]);
  });
});

describe('thinking', () => {
  it.each([
    [false, 'low', 'off'],
    [false, 'xhigh', 'off'],
    [true, 'low', 'low'],
    [true, 'medium', 'medium'],
    [true, 'xhigh', 'high'],
  ] as const)('thinking %s with effort %s shows as %s', (thinking, thinkingEffort, shown) => {
    expect(thinkingOf(task({ thinking, thinkingEffort }))).toBe(shown);
  });

  it.each(['off', 'low', 'medium', 'high'] as const)('%s comes back as itself', (v: Thinking) => {
    for (const start of [task({ thinking: false }), task({ thinking: true, thinkingEffort: 'xhigh' })]) {
      expect(thinkingOf(withThinking(start, v))).toBe(v);
    }
  });

  it('High is the strongest effort the server knows', () => {
    expect(withThinking(task(), 'high')).toMatchObject({ thinking: true, thinkingEffort: 'xhigh' });
    expect(withThinking(task(), 'low')).toMatchObject({ thinking: true, thinkingEffort: 'low' });
  });

  it('Off keeps the effort and the extra fields, for when you turn it on again', () => {
    const extra = { top_k: 20, chat_template_kwargs: { enable_thinking: true } };
    const off = withThinking(task({ thinking: true, thinkingEffort: 'xhigh', extra }), 'off');
    expect(off).toEqual(task({ thinking: false, thinkingEffort: 'xhigh', extra }));
  });
});

describe('a row on screen', () => {
  it('shows the settings, with no model as an empty box', () => {
    expect(rowOf(task({ thinking: true, thinkingEffort: 'medium', maxTokens: 900, temperature: 0.4, model: null }))).toEqual({
      thinking: 'medium',
      maxTokens: 900,
      temperature: 0.4,
      model: '',
    });
    expect(rowOf(task({ model: 'qwen3:8b' })).model).toBe('qwen3:8b');
  });

  it('goes back into the settings, keeping the extra fields', () => {
    const extra = { top_k: 20 };
    const before = task({ extra });
    const row: TaskRow = { thinking: 'low', maxTokens: 1500, temperature: 0.7, model: ' qwen3:8b ' };
    expect(fromRow(before, row)).toEqual({ ...before, thinking: true, thinkingEffort: 'low', maxTokens: 1500, temperature: 0.7, model: 'qwen3:8b' });
  });

  it('an empty Model means the same model as above', () => {
    expect(fromRow(task({ model: 'qwen3:8b' }), { ...rowOf(task()), model: '' }).model).toBeNull();
    expect(fromRow(task({ model: 'qwen3:8b' }), { ...rowOf(task()), model: '   ' }).model).toBeNull();
  });

  it('a row you have not touched saves the same settings', () => {
    for (const t of [task(), task({ thinking: false, thinkingEffort: 'xhigh', model: 'm', extra: { a: 1 } })]) {
      expect(fromRow(t, rowOf(t))).toEqual(t);
    }
  });
});

describe('a row that needs fixing', () => {
  const row = (r: Partial<TaskRow>): TaskRow => ({ ...rowOf(task()), ...r });
  const tokens = 'Rating a job: the longest answer must be a whole number, 16 or more.';
  const temperature = 'Rating a job: the temperature must be a number from 0 to 2.';

  it('is fine as it comes from the settings', () => {
    expect(rowProblem('Rating a job', row({}))).toBeNull();
    expect(rowProblem('Rating a job', row({ maxTokens: 16, temperature: 0 }))).toBeNull();
    expect(rowProblem('Rating a job', row({ temperature: 2 }))).toBeNull();
  });

  it.each([null, Number.NaN, 15, 10, 0, -5, 1500.5])('says so for a longest answer of %s', (maxTokens) => {
    expect(rowProblem('Rating a job', row({ maxTokens }))).toBe(tokens);
  });

  it.each([null, Number.NaN, -0.1, 2.1])('says so for a temperature of %s', (temperatureValue) => {
    expect(rowProblem('Rating a job', row({ temperature: temperatureValue }))).toBe(temperature);
  });
});
