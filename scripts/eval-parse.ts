// npm run eval:parse — how well an AI you've saved reads job ads.
//
// It reads every tests/fixtures/ads/*.txt that has a matching .expected.json
// (the fields filled in by hand), asks the AI to read it, and prints what it
// got right, field by field. It's a report, not a test.
//
//   npm run eval:parse                       the AI in use, from config/settings.json
//   npm run eval:parse -- --ai "NAME"        another saved AI, by its name or id, to compare models
//   npm run eval:parse -- --settings FILE    another settings file (and the secrets.json next to it)
//   npm run eval:parse -- --ads FOLDER       another folder of ads
//
// Your settings file is copied, never written, and the database is a
// temporary one, so your data is never touched. The run has its own profile
// and templates folders too (reading an ad needs neither). The copy gets the
// API key of the AI it runs, and no other, and it's deleted at the end. It
// may start llama-server, exactly as the app would.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import type { ParsedJob } from '../shared/contracts/index.ts';
import { buildApp } from '../server/app.ts';
import { resolvePaths } from '../server/core/config.ts';
import { prepareEvalConfig } from './eval-ai.ts';
import { scoreParse } from './eval-score.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const settingsFile = option('settings') ?? join(root, 'config', 'settings.json');
const adsDir = option('ads') ?? join(root, 'tests', 'fixtures', 'ads');

const scratch = mkdtempSync(join(tmpdir(), 'jr-eval-'));
// The copy may hold an API key, so it goes however the run ends: at the end,
// on an error, or when you stop it: Ctrl+C (SIGINT), closing the terminal
// window (SIGHUP, on Windows too) or a kill (SIGTERM). Only a forced kill,
// which no program can catch, leaves it in your temp folder.
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
for (const [signal, code] of [['SIGINT', 130], ['SIGHUP', 129], ['SIGTERM', 143]] as const) process.once(signal, () => process.exit(code));
const configDir = join(scratch, 'config');
mkdirSync(configDir, { recursive: true });
if (existsSync(settingsFile)) copyFileSync(settingsFile, join(configDir, 'settings.json'));
else console.log(`No settings file at ${settingsFile}, so the default AI settings are used.\n`);

const picked = prepareEvalConfig({ configDir, yourSecrets: join(dirname(settingsFile), 'secrets.json'), wanted: option('ai') });
if ('problem' in picked) {
  console.log(picked.problem);
  process.exit(1);
}
const { ai } = picked;

const paths = resolvePaths(root, {
  db: ':memory:',
  config: configDir,
  data: join(scratch, 'data'),
  // The app copies its starter files in wherever one is missing: here, never into the app folder.
  profile: join(scratch, 'profile'),
  templates: join(scratch, 'templates'),
});
const app = await buildApp({ paths, logger: pino({ level: 'silent' }), version: 'eval' });
console.log(`AI: ${ai.name} (${ai.preset}) at ${ai.baseUrl}${ai.model ? `, model ${ai.model}` : ''}\n`);

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
