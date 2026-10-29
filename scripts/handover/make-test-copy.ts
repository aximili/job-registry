// Handover step: makes the test copy of the app (by default
// %USERPROFILE%\JobRegistryTest), without your data, settings, secrets,
// profile, templates or the AI, then runs setup.bat -Quiet in it.
// The checks that start and stop the app only ever use this copy.
//
//   node scripts\handover\make-test-copy.ts
//   --link-modules   (for the Mac tests) links node_modules instead of running setup

import { cpSync, existsSync, symlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  createReport,
  hasFlag,
  IS_WINDOWS,
  keepInTestCopy,
  killPortListeners,
  prepareTestRoot,
  REAL_ROOT,
  runBat,
  testPort,
  testRoot,
  testSettings,
  writeTestSettings,
} from './lib.ts';

const report = createReport('make-test-copy');
const root = testRoot();

if (root === REAL_ROOT) {
  report.fail('the test copy is somewhere else', `JR_TEST_ROOT points at the real app folder (${root})`);
  process.exit(report.finish());
}

// An old test copy still running would lock its files.
killPortListeners([testPort(), 8081]);

try {
  prepareTestRoot(root);
  report.pass('the test copy folder is ready', root);
} catch (err) {
  report.fail('the test copy folder is ready', (err as Error).message);
  process.exit(report.finish());
}

cpSync(REAL_ROOT, root, { recursive: true, force: true, filter: (src) => keepInTestCopy(relative(REAL_ROOT, src)) });
const leaked = ['data', 'profile', 'templates', 'ai', join('config', 'settings.json'), join('config', 'secrets.json')].filter((p) =>
  existsSync(join(root, p)),
);
if (leaked.length > 0) report.fail('the copy leaves out your data', `found ${leaked.join(', ')}`);
else report.pass('the app is copied, without your data, settings, profile or the AI');

if (hasFlag('link-modules')) {
  symlinkSync(join(REAL_ROOT, 'node_modules'), join(root, 'node_modules'), IS_WINDOWS ? 'junction' : 'dir');
  if (existsSync(join(REAL_ROOT, 'web', 'dist'))) cpSync(join(REAL_ROOT, 'web', 'dist'), join(root, 'web', 'dist'), { recursive: true });
  report.info('setup skipped', 'node_modules is linked (Mac tests only)');
} else if (IS_WINDOWS) {
  const setup = runBat(root, 'setup.bat', ['-Quiet'], 1_800_000);
  const out = `${setup.stdout}${setup.stderr}`;
  if (setup.status === 0 && out.includes('All set.')) report.pass('setup.bat -Quiet installs and builds the app');
  else report.fail('setup.bat -Quiet installs and builds the app', `exit code ${setup.status}; the last lines: ${out.trim().split(/\r?\n/).slice(-3).join(' | ')}`);
  for (const [file, what] of [
    [join('node_modules', 'better-sqlite3', 'package.json'), 'packages are installed'],
    [join('web', 'dist', 'index.html'), 'the dashboard is built'],
    [join('extension', 'dist', 'firefox', 'manifest.json'), 'the extension is built'],
    [join('config', 'settings.json'), 'setup made a settings file'],
  ] as const) {
    if (existsSync(join(root, file))) report.pass(what);
    else report.fail(what, `${file} is missing`);
  }
} else {
  report.info('setup skipped', 'not Windows');
}

writeTestSettings(root, testSettings({ port: testPort() }));
report.pass('the test copy has its own settings', `port ${testPort()}, no email, no AI`);
process.exit(report.finish());
