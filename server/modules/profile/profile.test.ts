import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProfileModule } from './index.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jr-profile-'));
  dirs.push(root);
  const dir = join(root, 'profile');
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return { dir, profile: createProfileModule({ dir }).service };
}

describe('profile', () => {
  it('read returns null for a missing or blank file, and drops a byte-order mark', () => {
    const bom = String.fromCharCode(0xfeff);
    const { profile } = setup({ 'preferences.md': '  \n ', 'master-profile.md': `${bom}# Me\nI write TypeScript.` });
    expect(profile.read('master-profile')).toBe('# Me\nI write TypeScript.');
    expect(profile.read('preferences')).toBeNull();
    expect(setup().profile.read('master-profile')).toBeNull();
  });

  it('the hash changes when either file changes', () => {
    const { dir, profile } = setup({ 'master-profile.md': 'A' });
    const first = profile.hash();
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    writeFileSync(join(dir, 'preferences.md'), 'Remote only');
    const second = profile.hash();
    writeFileSync(join(dir, 'master-profile.md'), 'B');
    expect(new Set([first, second, profile.hash()]).size).toBe(3);
  });
});
