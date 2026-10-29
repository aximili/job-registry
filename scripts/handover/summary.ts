// Handover step: writes handover-results\summary.md from results.txt and the
// bug files, so the summary never depends on remembering anything.
//
//   node scripts\handover\summary.ts

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REAL_ROOT, resultsFile } from './lib.ts';

const file = resultsFile();
const dir = dirname(file);
const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];

// The last "<script>: all PASS." or "<script>: N FAIL." line of each check, in the order they ran.
const results = new Map<string, string>();
for (const line of lines) {
  const m = /^\S+ \S+ ([\w-]+): \1: (all PASS|\d+ FAIL)\./.exec(line);
  if (m) {
    results.delete(m[1]!);
    results.set(m[1]!, m[2]!);
  }
}
const lastMatch = (pattern: RegExp) => {
  const hit = lines.filter((l) => pattern.test(l)).at(-1);
  return hit ? pattern.exec(hit)?.[1] : undefined;
};
const read = lastMatch(/PASS the AI reads a saved ad - (\d+) s/);
const wrote = lastMatch(/PASS the AI writes a resume - (\d+) s/);
const signed = lastMatch(/sign: (PASS the extension is signed|INFO not signed|FAIL[^-]*)/);

const bugsDir = join(dir, 'bugs');
const bugs = existsSync(bugsDir) ? readdirSync(bugsDir).filter((f) => /^bug-\d+\.md$/.test(f)).sort() : [];
const bugLines = bugs.map((f) => {
  const first = readFileSync(join(bugsDir, f), 'utf8').split(/\r?\n/).find((l) => l.startsWith('## ')) ?? '';
  return `- ${f}: ${first.replace(/^## Bug \d+:\s*/, '')}`;
});

const text = [
  '# Handover summary',
  '',
  `Date: ${new Date().toISOString().slice(0, 10)}`,
  `App folder: ${REAL_ROOT}`,
  '',
  '## Results',
  ...(results.size > 0 ? [...results].map(([name, result]) => `- ${name}: ${result}`) : ['- No checks have run yet.']),
  `- signing: ${signed ?? 'not run'}`,
  `- reading-quality report: ${existsSync(join(dir, 'eval-report.txt')) ? 'eval-report.txt' : 'not made'}`,
  '',
  '## Times',
  `- Reading an ad: ${read ? `${read} s` : 'not measured'}`,
  `- Writing a resume: ${wrote ? `${wrote} s` : 'not measured'}`,
  '',
  '## Bugs',
  bugs.length === 0 ? 'No bugs.' : `${bugs.length} bug${bugs.length === 1 ? '' : 's'}:`,
  ...bugLines,
  '',
].join('\r\n');
writeFileSync(join(dir, 'summary.md'), text);
console.log(`Wrote ${join(dir, 'summary.md')}`);
