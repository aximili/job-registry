import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/contracts/index.ts';

it('settings.example.json matches DEFAULT_SETTINGS', () => {
  const example = JSON.parse(readFileSync(new URL('../config/settings.example.json', import.meta.url), 'utf8'));
  expect(example).toEqual(DEFAULT_SETTINGS);
  // The saved-AIs shape, not the older one-AI shape that the app still reads.
  expect(example.ai).toMatchObject({ active: 'bonsai-2', saved: [{ id: 'bonsai-2', name: 'Bonsai 2' }] });
});
