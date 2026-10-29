// Handover step 1: is everything the app needs on this PC? Read-only.
//
//   node scripts\handover\prereqs.ts

import { existsSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import {
  aiServerAnswers,
  appAi,
  createReport,
  findFirefox,
  healthy,
  IS_WINDOWS,
  portAnswers,
  readRealSettings,
  REAL_ROOT,
  runCommand,
  testPort,
} from './lib.ts';

const report = createReport('prereqs');
const run = (command: string) => runCommand(command, REAL_ROOT, 30_000);
const answers = async (url: string) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    return false;
  }
};

if (IS_WINDOWS) report.pass('this is Windows');
else report.info('this is not Windows', 'the Windows-only checks are skipped');

const major = Number(process.versions.node.split('.')[0]);
if (major >= 24) report.pass('Node.js 24 or later', process.version);
else report.fail('Node.js 24 or later', `found ${process.version}. Install it with: winget install OpenJS.NodeJS.LTS`);

const npm = run('npm -v');
if (npm.status === 0) report.pass('npm works', npm.stdout.trim());
else report.fail('npm works', 'npm -v failed. Reinstall Node.js.');

const git = run('git --version');
if (git.status === 0) report.pass('Git works', git.stdout.trim());
else report.fail('Git works', 'git --version failed. Install it with: winget install Git.Git');
if (existsSync(join(REAL_ROOT, '.git'))) report.pass('the app folder is a Git checkout');
else report.fail('the app folder is a Git checkout', `${REAL_ROOT} has no .git folder, so one unit test (gitignore) can't run`);

const disk = statfsSync(REAL_ROOT);
const freeGb = (disk.bavail * disk.bsize) / 1024 ** 3;
if (freeGb >= 15) report.pass('15 GB of free disk space', `${freeGb.toFixed(0)} GB free`);
else report.fail('15 GB of free disk space', `only ${freeGb.toFixed(1)} GB free`);

if (IS_WINDOWS) {
  const firefox = findFirefox();
  if (firefox) report.pass('Firefox is installed', firefox);
  else report.fail('Firefox is installed', 'not found in Program Files, AppData or the Microsoft Store apps. Install it with: winget install Mozilla.Firefox');

  const gpu = run('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader');
  if (gpu.status === 0) report.pass('an NVIDIA graphics card is ready', gpu.stdout.trim());
  else report.fail('an NVIDIA graphics card is ready', 'nvidia-smi failed. Install or update the NVIDIA driver.');
}

if (await answers('http://127.0.0.1:8080/health')) report.pass('Bonsai 2 answers on port 8080 (the agent uses it)');
else report.info('nothing answers on port 8080', 'start Bonsai 2 there (see do-by-hand.md)');

for (const p of [testPort(), 8081, 4798, 4799]) {
  if (await portAnswers(p)) report.fail(`port ${p} is free for the checks`, 'something answers there. Run node scripts\\handover\\cleanup.ts');
  else report.pass(`port ${p} is free for the checks`);
}

// Your own settings, read only: do they still load?
const real = readRealSettings();
if (!real.exists) report.info('no config\\settings.json yet', 'setup.bat makes it');
else if (real.settings) report.pass('your config\\settings.json is valid');
else report.fail('your config\\settings.json is valid', real.error ?? 'it did not load');
if (real.settings) {
  const realPort = real.settings.server.port;
  report.info(`the real app on port ${realPort}`, (await healthy(realPort)) ? 'running' : 'not running');

  // The AI that Settings -> AI picks: a server you run yourself, or Bonsai 2
  // started by the app, which needs its program and model on this PC.
  const ai = appAi(real.settings.ai);
  if (ai.kind === 'external') {
    if (await aiServerAnswers(ai.baseUrl)) report.pass('your AI server answers', `${ai.baseUrl} (you run it; the app never starts or stops it)`);
    else report.fail('your AI server answers', `nothing answers at ${ai.baseUrl}. Start it, or change Settings -> AI (see do-by-hand.md).`);
  } else {
    const missing = [ai.exe, ai.model ?? 'the model (no -m in Settings -> AI -> Arguments)'].find((p) => !existsSync(p));
    if (!missing) report.pass("the app's own Bonsai 2 is downloaded", ai.model!);
    else {
      report.fail(
        "the app's own Bonsai 2 is downloaded",
        `missing ${missing}. Settings -> AI has the app start Bonsai 2 itself. Run download-ai.bat, or point the app at the Bonsai 2 you run yourself (see do-by-hand.md).`,
      );
    }
  }
}

process.exit(report.finish());
