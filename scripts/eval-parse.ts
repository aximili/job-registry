// npm run eval:parse — how well the AI you've set up reads job ads.
//
// It reads every tests/fixtures/ads/*.txt that has a matching .expected.json
// (the fields filled in by hand), asks the AI in your settings to read it,
// and prints what it got right, field by field. It's a report, not a test.
//
//   npm run eval:parse                      uses config/settings.json
//   npm run eval:parse -- --settings FILE   uses another settings file
//   npm run eval:parse -- --ads FOLDER      uses another folder of ads
//
// Your settings file is copied, never written, and the database is a
// temporary one, so your data is never touched. It may start llama-server,
// exactly as the app would.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import type { ParsedJob } from '../shared/contracts/index.ts';
import { buildApp } from '../server/app.ts';
import { resolvePaths } from '../server/core/config.ts';
import { scoreParse } from './eval-score.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const settingsFile = option('settings') ?? join(root, 'config', 'settings.json');
const adsDir = option('ads') ?? join(root, 'tests', 'fixtures', 'ads');

const scratch = mkdtempSync(join(tmpdir(), 'jr-eval-'));
const configDir = join(scratch, 'config');
mkdirSync(configDir, { recursive: true });
if (existsSync(settingsFile)) copyFileSync(settingsFile, join(configDir, 'settings.json'));
else console.log(`No settings file at ${settingsFile}, so the default AI settings are used.\n`);

const paths = resolvePaths(root, { db: ':memory:', config: configDir, data: join(scratch, 'data') });
const app = await buildApp({ paths, logger: pino({ level: 'silent' }), version: 'eval' });
const ai = app.services.settings.get().ai;
console.log(`AI: ${ai.preset} at ${ai.baseUrl}${ai.model ? `, model ${ai.model}` : ''}\n`);

const ads = readdirSync(adsDir)
  .filter((f) => f.endsWith('.txt') && existsSync(join(adsDir, f.replace(/\.txt$/, '.expected.json'))))
  .sort();
if (ads.length === 0) console.log(`No ads with answers in ${adsDir}. See tests/fixtures/ads/README.md.`);

const totals = new Map<string, { right: number; total: number }>();
const times: number[] = [];

for (const file of ads) {
  const name = file.replace(/\.txt$/, '');
  const text = readFileSync(join(adsDir, file), 'utf8');
  const expected = JSON.parse(readFileSync(join(adsDir, `${name}.expected.json`), 'utf8')) as Partial<ParsedJob>;
  const started = Date.now();
  let parsed: ParsedJob;
  try {
    parsed = await app.services.ai.parseJob(text, { priority: 'interactive' });
  } catch (err) {
    console.log(`✗ ${name}: ${(err as Error).message}`);
    for (const key of Object.keys(expected)) bump(key, false);
    continue;
  }
  const seconds = (Date.now() - started) / 1000;
  times.push(seconds);
  const scores = scoreParse(expected, parsed);
  const right = Object.values(scores).filter(Boolean).length;
  const misses = Object.entries(scores)
    .filter(([, ok]) => !ok)
    .map(([key]) => `${key} (got ${JSON.stringify(parsed[key as keyof ParsedJob])})`);
  console.log(`${misses.length ? '•' : '✓'} ${name}: ${right}/${Object.keys(scores).length} right in ${seconds.toFixed(1)} s`);
  for (const miss of misses) console.log(`    missed ${miss}`);
  for (const [key, ok] of Object.entries(scores)) bump(key, ok);
}

function bump(key: string, ok: boolean): void {
  const t = totals.get(key) ?? { right: 0, total: 0 };
  t.total++;
  if (ok) t.right++;
  totals.set(key, t);
}

if (totals.size > 0) {
  console.log('\nField               Right  Total     %');
  for (const [key, t] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${key.padEnd(18)} ${String(t.right).padStart(6)} ${String(t.total).padStart(6)} ${String(Math.round((100 * t.right) / t.total)).padStart(5)}`);
  }
}
if (times.length > 0) {
  const average = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`\nAverage time per ad: ${average.toFixed(1)} s (Phase 2's goal: about 20 s or less).`);
}

await app.close();
rmSync(scratch, { recursive: true, force: true });
