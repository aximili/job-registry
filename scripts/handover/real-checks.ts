// Handover step: read-only checks of your real install, after you've run
// setup.bat and done your own steps. It changes nothing. Its two requests
// are the Test connection buttons: Gmail's only logs in and opens the inbox,
// and the AI's asks one short question.
//
//   node scripts\handover\real-checks.ts

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '../../shared/contracts/index.ts';
import { api, createReport, healthy, IS_WINDOWS, readRealSettings, REAL_ROOT } from './lib.ts';

const report = createReport('real-checks');
const real = readRealSettings();
if (real.error) report.fail('your config\\settings.json is valid', real.error);
const settings = real.settings ?? DEFAULT_SETTINGS;
const port = settings.server.port;

if (IS_WINDOWS) {
  const folder = (name: string) =>
    spawnSync('powershell', ['-NoProfile', '-Command', `[Environment]::GetFolderPath('${name}')`], { encoding: 'utf8' }).stdout.trim();
  const desktop = join(folder('Desktop'), 'Job Registry.lnk');
  if (existsSync(desktop)) report.pass('the Desktop shortcut is there', desktop);
  else report.fail('the Desktop shortcut is there', `${desktop} is missing. Run setup.bat and answer Y.`);
  const startup = join(folder('Startup'), 'Job Registry.lnk');
  report.info('start at log-in', existsSync(startup) ? 'on' : 'off (your choice in setup.bat)');
}

for (const [dir, what] of [
  [join(REAL_ROOT, 'node_modules'), 'packages are installed'],
  [join(REAL_ROOT, 'web', 'dist', 'index.html'), 'the dashboard is built'],
  [join(REAL_ROOT, 'extension', 'dist', 'firefox', 'manifest.json'), 'the Firefox extension is built'],
] as const) {
  if (existsSync(dir)) report.pass(what);
  else report.fail(what, `${dir} is missing. Run setup.bat.`);
}

const artifacts = join(REAL_ROOT, 'extension', 'dist', 'signed');
const xpi = existsSync(artifacts) ? readdirSync(artifacts).filter((f) => f.endsWith('.xpi')) : [];
report.info('a signed Firefox extension', xpi.length > 0 ? xpi.join(', ') : 'none yet (needs your addons.mozilla.org keys)');

const profile = join(REAL_ROOT, 'profile', 'master-profile.md');
if (existsSync(profile) && statSync(profile).size > 200) report.pass('your master profile is saved', `${statSync(profile).size} bytes`);
else report.fail('your master profile is saved', 'Settings -> Profile -> Master profile is empty. Paste your resume there.');

if (await healthy(port)) {
  report.pass('the app is running', `port ${port}`);
  const email = settings.email;
  if (email.enabled && email.address) {
    const test = await api(port, 'POST', '/email/test', {}, 60_000);
    if (test.json?.ok) report.pass('Gmail answers', test.json.detail);
    else report.fail('Gmail answers', test.json?.detail ?? `status ${test.status}`);
  } else {
    report.info('Gmail is off', 'turn it on in Settings -> Email to check it');
  }
  // Secrets never come back: only whether one is set.
  const settingsText = (await api(port, 'GET', '/settings')).text;
  const secrets = await api(port, 'GET', '/settings/secrets');
  const onlyFlags = secrets.json && Object.values(secrets.json).every((v) => typeof v === 'boolean');
  if (!settingsText.includes('emailPassword') && onlyFlags) report.pass('no password comes back from the app');
  else report.fail('no password comes back from the app', 'GET /settings or /settings/secrets holds more than true or false');
  if (email.enabled) {
    const status = (await api(port, 'GET', '/email/status')).json;
    if (status?.lastCheckAt && !status.lastError) report.info('the last Gmail check', `${status.lastCheckAt}, ${status.lastAdded ?? 0} new, ${status.pending} waiting in the Inbox`);
    else if (status?.lastError) report.fail('the last Gmail check worked', status.lastError);
    else report.info('Gmail has not been checked yet', 'the first check runs a minute after the app starts');
  }
  const ai = await api(port, 'GET', '/ai/status');
  report.info('the AI', `${ai.json?.state ?? 'unknown'} (${ai.json?.baseUrl ?? '?'})`);
  // As Settings -> AI -> Test connection does.
  const aiTest = await api(port, 'POST', '/ai/test', {}, 300_000);
  if (aiTest.json?.ok) report.pass("the app's AI answers", aiTest.json.detail);
  else report.fail("the app's AI answers", aiTest.json?.detail ?? `status ${aiTest.status}`);
} else if (settings.email.enabled) {
  report.fail('the app is running, to check Gmail', `email is on, but nothing answers on port ${port}. Start the app with the Desktop shortcut, then run this again.`);
} else {
  report.info('the app is not running', `port ${port}`);
}

process.exit(report.finish());
