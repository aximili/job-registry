// Handover step: the app's own tests, in the test copy: npm test (types,
// architecture rules, unit and API tests) and npm run test:e2e (the dashboard
// in Firefox and Chromium, and the extension in Chromium). 20 to 40 minutes.
//
//   node scripts\handover\run-tests.ts
//   --unit-only   only npm test

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createReport, hasFlag, isTestCopy, killPortListeners, resultsFile, runCommand, testRoot } from './lib.ts';

const report = createReport('run-tests');
const root = testRoot();
const logDir = dirname(resultsFile());
mkdirSync(logDir, { recursive: true });

if (!isTestCopy(root)) {
  report.fail('the test copy is there', `${root} isn't a test copy. Run make-test-copy.ts first.`);
  process.exit(report.finish());
}

// Runs a command in the test copy, keeps its output in a log, and reports its
// summary line, and on a failure the names of the tests that failed.
function step(name: string, command: string, log: string, summary: RegExp, timeoutMs: number): void {
  const res = runCommand(command, root, timeoutMs);
  const out = `${res.stdout}${res.stderr}`;
  const file = join(logDir, log);
  writeFileSync(file, out);
  const lines = out.split(/\r?\n/);
  const found = lines.filter((l) => summary.test(l)).map((l) => l.trim()).join('; ');
  if (res.status === 0) {
    report.pass(name, `${found} (log: ${file})`);
    return;
  }
  const failed = [...new Set(lines.filter((l) => /^\s*(✘|×|FAIL\s)/.test(l)).map((l) => l.trim()))].slice(0, 8);
  report.fail(name, `exit code ${res.status ?? 'timed out'}. ${found} Failed: ${failed.join(' || ') || 'see the log'}. Log: ${file}`);
  // A timed-out run can leave its servers behind, which would spoil the next run.
  if (res.status === null) killPortListeners([4798, 4799]);
}

step('npm test passes', 'npm test', 'npm-test.log', /Tests\s+\d+/, 1_200_000);
step("Mozilla's extension checks pass", 'npm run ext:lint', 'ext-lint.log', /errors\s+\d+/, 300_000);
if (!hasFlag('unit-only')) {
  step('the test browsers are installed', 'npx playwright install firefox chromium', 'playwright-install.log', /^\S/, 1_200_000);
  step('npm run test:e2e passes', 'npm run test:e2e', 'npm-test-e2e.log', /^\s*\d+ (passed|failed|flaky)/, 2_400_000);
}
process.exit(report.finish());
