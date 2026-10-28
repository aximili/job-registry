import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fillPrompt, loadPrompt } from './prompts.ts';

const dir = fileURLToPath(new URL('./prompts/', import.meta.url));

// What each task fills in. A prompt asking for anything else would fail at run time.
const VALUES: Record<string, string[]> = {
  'parse-job': ['today', 'ad'],
  'rate-job': ['profile', 'preferences', 'ad'],
  'write-resume': ['profile', 'guide', 'job', 'ad'],
  'write-cover-letter': ['profile', 'guide', 'today', 'job', 'ad'],
};

describe('prompts', () => {
  it('every prompt file has a system part and a user part, and every placeholder is filled', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    expect(files.sort()).toEqual(Object.keys(VALUES).map((n) => `${n}.md`).sort());
    for (const file of files) {
      const name = file.replace(/\.md$/, '');
      const prompt = loadPrompt(dir, name);
      expect(prompt.system.trim().length).toBeGreaterThan(50);
      expect(prompt.user.trim().length).toBeGreaterThan(0);
      const used = [...readFileSync(`${dir}${file}`, 'utf8').matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      expect([...new Set(used)].sort()).toEqual([...VALUES[name]!].sort());
    }
  });

  it('the ad comes last in every prompt', () => {
    for (const name of Object.keys(VALUES)) {
      const { user } = loadPrompt(dir, name);
      expect(user.trim().endsWith('{{ad}}')).toBe(true);
    }
  });

  it('fillPrompt refuses a missing value', () => {
    expect(fillPrompt('Hi {{name}}', { name: 'Sam' })).toBe('Hi Sam');
    expect(() => fillPrompt('Hi {{name}}', {})).toThrow('Prompt placeholder {{name}} has no value');
  });

  it('a value with $ or {{ }} in it is inserted as it is', () => {
    expect(fillPrompt('Pay: {{ad}}', { ad: '$100k {{not a placeholder}} $&' })).toBe('Pay: $100k {{not a placeholder}} $&');
  });
});
