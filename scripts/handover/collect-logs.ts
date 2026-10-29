// Handover step: copies the logs to attach to a bug into
// handover-results\logs-<date>\ (the test copy's and the real app's).
// The app's logs never hold email text or secrets.
//
//   node scripts\handover\collect-logs.ts

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createReport, REAL_ROOT, resultsFile, testRoot } from './lib.ts';

const report = createReport('collect-logs');
const d = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
// Local time, like results.txt.
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
const target = join(dirname(resultsFile()), `logs-${stamp}`);
mkdirSync(target, { recursive: true });
const evalReport = join(testRoot(), 'eval-report.txt');
if (existsSync(evalReport)) {
  cpSync(evalReport, join(target, 'eval-report.txt'));
  report.pass('the reading-quality report is copied', join(target, 'eval-report.txt'));
}
for (const [from, name] of [
  [join(testRoot(), 'data', 'logs'), 'test-copy'],
  [join(REAL_ROOT, 'data', 'logs'), 'real-app'],
  // Playwright's traces of failed browser tests.
  [join(testRoot(), 'test-results'), 'browser-test-traces'],
] as const) {
  if (existsSync(from)) {
    cpSync(from, join(target, name), { recursive: true });
    report.pass(`the ${name} logs are copied`, join(target, name));
  } else {
    report.info(`no ${name} logs`, from);
  }
}
process.exit(report.finish());
