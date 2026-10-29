// Handover step: how well the test copy's AI reads the sample ads, as a
// report (not a test), saved to handover-results\eval-report.txt.
// Run it after ai-smoke.ts, which gives the test copy its AI settings.
//
//   node scripts\handover\eval-report.ts

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createReport, isTestCopy, resultsFile, runCommand, testRoot } from './lib.ts';

const report = createReport('eval-report');
const root = testRoot();
if (!isTestCopy(root)) {
  report.fail('the test copy is there', `${root} isn't a test copy. Run make-test-copy.ts first.`);
  process.exit(report.finish());
}
const res = runCommand('npm run eval:parse -- --settings config/settings.json', root, 1_800_000);
const out = join(dirname(resultsFile()), 'eval-report.txt');
writeFileSync(out, `${res.stdout}${res.stderr}`);
if (res.status === 0) report.pass('the reading-quality report is made', out);
else report.fail('the reading-quality report is made', `exit code ${res.status ?? 'timed out'}; see ${out}`);
process.exit(report.finish());
