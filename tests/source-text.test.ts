// Invisible characters (byte-order marks, zero-width spaces, direction marks,
// non-breaking spaces) look like nothing in an editor, so a reviewer can't see
// them. Source code writes them as \u escapes instead.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const FOLDERS = ['server', 'shared', 'web/src', 'tests', 'scripts', 'extension', 'starters'];
const CODE = /\.(ts|svelte|mjs|cjs|js|css|html|json|ps1|bat|md)$/;
const INVISIBLE = /[\p{Cf}\u00A0\u2000-\u200A\u202F\u205F\u3000]/gu;

function* files(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (CODE.test(entry.name)) yield path;
  }
}

describe('source text', () => {
  it('has no literal invisible characters', () => {
    const found: string[] = [];
    let scanned = 0;
    for (const folder of FOLDERS) {
      for (const path of files(join(root, folder))) {
        scanned++;
        const lines = readFileSync(path, 'utf8').split('\n');
        lines.forEach((line, i) => {
          for (const m of line.matchAll(INVISIBLE)) {
            found.push(`${relative(root, path)}:${i + 1} U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
          }
        });
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(found).toEqual([]);
  });
});
