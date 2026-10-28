// Prompts are plain text files in prompts/, so the wording can change without
// touching code. A file holds the system part, a line "=== user ===", then
// the user part. Both may use {{placeholders}}.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROMPTS_DIR = fileURLToPath(new URL('./prompts/', import.meta.url));

const SPLIT = /^=== user ===$/m;

export type Prompt = { system: string; user: string };

export function loadPrompt(dir: string, name: string): Prompt {
  const text = readFileSync(join(dir, `${name}.md`), 'utf8').replace(/^\uFEFF/, '');
  const parts = text.split(SPLIT);
  if (parts.length !== 2) throw new Error(`Prompt ${name}.md needs exactly one "=== user ===" line`);
  return { system: parts[0]!.trim(), user: parts[1]!.trim() };
}

export function fillPrompt(template: string, values: Record<string, string>): string {
  // One pass, so text inside a value (an ad with "{{" or "$&" in it) is left alone.
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`Prompt placeholder {{${key}}} has no value`);
    return value;
  });
}
