// Handover step: starts the test copy of the app, checks it, and stops it.
// On Windows it uses start.bat, setup.bat and stop.bat themselves.
//
//   node scripts\handover\app-smoke.ts

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  api,
  createReport,
  healthy,
  IS_WINDOWS,
  isTestCopy,
  runBat,
  startApp,
  statusWithHost,
  stopApp,
  testPort,
  testRoot,
  testSettings,
  waitFor,
  writeTestSettings,
} from './lib.ts';

const report = createReport('app-smoke');
const root = testRoot();
const port = testPort();

if (!isTestCopy(root)) {
  report.fail('the test copy is there', `${root} isn't a test copy. Run make-test-copy.ts first.`);
  process.exit(report.finish());
}
if (await healthy(port)) {
  report.fail('the test port is free', `something already answers on port ${port}. Run stop.bat in ${root}.`);
  process.exit(report.finish());
}

const started = startApp(root);
if (started.code === 0 && (await waitFor(() => healthy(port), 30_000))) report.pass('the app starts', `port ${port}`);
else {
  const error = join(root, 'data', 'logs', 'startup-error.txt');
  const why = existsSync(error) ? readFileSync(error, 'utf8').trim() : started.output.trim() || 'no answer within 30 seconds';
  report.fail('the app starts', why.split(/\r?\n/).join(' | '));
  process.exit(report.finish());
}

try {
  const health = await api(port, 'GET', '/health');
  if (health.json?.ok === true) report.pass('health answers', `version ${health.json.version}`);
  else report.fail('health answers', `status ${health.status}: ${health.text.slice(0, 200)}`);

  if (IS_WINDOWS) {
    const again = runBat(root, 'start.bat', ['--no-browser'], 120_000);
    if (again.status === 0 && (await healthy(port))) report.pass('start.bat again only opens the dashboard');
    else report.fail('start.bat again only opens the dashboard', `exit code ${again.status}`);
  }

  const page = await fetch(`http://127.0.0.1:${port}/`);
  const html = await page.text();
  if (page.status === 200 && html.includes('<title>Job Registry</title>')) report.pass('the dashboard is served');
  else report.fail('the dashboard is served', `status ${page.status}`);

  const otherHost = await statusWithHost(port, 'evil.example');
  if (otherHost === 403) report.pass('a request for another host name is refused');
  else report.fail('a request for another host name is refused', `status ${otherHost}, expected 403`);

  const crossSite = await fetch(`http://127.0.0.1:${port}/api/v1/system/backup`, {
    method: 'POST',
    headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
    body: '{}',
  });
  if (crossSite.status === 403) report.pass('a write from another website is refused');
  else report.fail('a write from another website is refused', `status ${crossSite.status}, expected 403`);

  const backup = await api(port, 'POST', '/system/backup');
  if (backup.status === 200 && backup.json?.file && existsSync(backup.json.file)) report.pass('a backup is made', backup.json.file);
  else report.fail('a backup is made', `status ${backup.status}: ${backup.text.slice(0, 200)}`);

  const saved = await api(port, 'POST', '/jobs', {
    capture: { sourceUrl: null, canonicalUrl: null, sourceSite: 'pasted', externalId: null, jdText: 'Senior Engineer at Atlassian. A handover check.', capturedAt: new Date().toISOString() },
    fields: { title: 'Senior Engineer', company: 'Atlassian' },
    decision: 'new',
  });
  const found = await api(port, 'GET', '/search?q=atlas');
  const hit = (found.json?.hits ?? []).some((h: { jobId?: number }) => h.jobId === saved.json?.job?.id);
  if (saved.status === 201 && hit) report.pass('a job is saved and found by search');
  else report.fail('a job is saved and found by search', `save status ${saved.status}, search status ${found.status}`);

  const jobId = saved.json?.job?.id as number | undefined;
  if (existsSync(join(root, 'profile', 'resume-guide.md')) && existsSync(join(root, 'templates', 'resume.css'))) {
    report.pass('the starter guides and templates are copied in');
  } else report.fail('the starter guides and templates are copied in', 'profile\\resume-guide.md or templates\\resume.css is missing');

  // The recruiter-call test: log a call with a phone number, then find the job by part of it.
  const call = await api(port, 'POST', '/interactions', { newContact: { name: 'Sam Lee', phone: '0412 345 678' }, jobId, notes: 'Called about the role.' });
  const t0 = Date.now();
  const byPhone = await api(port, 'GET', `/search?q=${encodeURIComponent('345 678')}`);
  const ms = Date.now() - t0;
  if ((call.status === 200 || call.status === 201) && byPhone.json?.hits?.[0]?.jobId === jobId && ms < 2000) {
    report.pass('a job is found by part of a phone number in under 2 seconds', `${ms} ms`);
  } else report.fail('a job is found by part of a phone number in under 2 seconds', `call status ${call.status}, ${ms} ms, first hit ${JSON.stringify(byPhone.json?.hits?.[0] ?? null)}`);

  // The test copy's AI address has nothing behind it: the job waits, and says why.
  let waiting: { parseState?: string; parseError?: string | null } = {};
  await waitFor(async () => {
    waiting = (await api(port, 'GET', `/jobs/${jobId}`)).json ?? {};
    return !!waiting.parseError;
  }, 20_000);
  if (waiting.parseState === 'pending' && waiting.parseError?.includes('127.0.0.1:9')) report.pass('a job saved while the AI is off waits, and says why');
  else report.fail('a job saved while the AI is off waits, and says why', `parse state "${waiting.parseState}", "${waiting.parseError ?? ''}"`);

  // A file with accents and an emoji in its name, on this computer's file system.
  const form = new FormData();
  form.append('file', new Blob(['%PDF-1.4 a handover check']), 'R\u00e9sum\u00e9 \u{1F680}.pdf');
  const attached = await fetch(`http://127.0.0.1:${port}/api/v1/jobs/${jobId}/attachments?kind=resume`, {
    method: 'POST',
    headers: { origin: `http://127.0.0.1:${port}` },
    body: form,
  });
  const attachment = (await attached.json().catch(() => null)) as { id?: number } | null;
  const download = attachment?.id ? await fetch(`http://127.0.0.1:${port}/api/v1/attachments/${attachment.id}`) : null;
  const disposition = download?.headers.get('content-disposition') ?? '';
  if (attached.status === 201 && download?.status === 200 && disposition.includes("UTF-8''R%C3%A9sum%C3%A9")) {
    report.pass('a file with an accented name is attached, and downloads with its name');
  } else report.fail('a file with an accented name is attached, and downloads with its name', `attach ${attached.status}, download ${download?.status ?? '-'}, ${disposition}`);
  const big = new FormData();
  big.append('file', new Blob([new Uint8Array(16 * 1024 * 1024)]), 'too-big.pdf');
  const refused = await fetch(`http://127.0.0.1:${port}/api/v1/jobs/${jobId}/attachments?kind=other`, {
    method: 'POST',
    headers: { origin: `http://127.0.0.1:${port}` },
    body: big,
  });
  const refusedText = await refused.text();
  if (refused.status >= 400 && refused.status < 500 && refusedText.includes('15 MB')) report.pass('a file over 15 MB is refused, with a plain message');
  else report.fail('a file over 15 MB is refused, with a plain message', `status ${refused.status}: ${refusedText.slice(0, 200)}`);

  // A guide edited in Notepad shows in the app at once.
  writeFileSync(join(root, 'profile', 'resume-guide.md'), '# My resume guide\r\nEdited on disk for the handover check.\r\n');
  const guide = await api(port, 'GET', '/profile/resume-guide');
  if (guide.json?.text?.includes('Edited on disk for the handover check.')) report.pass('a guide edited on disk shows in the app');
  else report.fail('a guide edited on disk shows in the app', `status ${guide.status}`);

  // A phone number pasted from an email signature or Teams, written another way.
  const plus = await api(port, 'GET', `/search?q=${encodeURIComponent('+61 412 345 678')}`);
  if (plus.json?.hits?.[0]?.jobId === jobId) report.pass('a phone number written another way finds the job');
  else report.fail('a phone number written another way finds the job', `first hit ${JSON.stringify(plus.json?.hits?.[0] ?? null)}`);

  const second = await api(port, 'POST', '/system/backup');
  const backups = join(root, 'data', 'backups');
  const copied = join(backups, 'files', String(jobId));
  if (second.status === 200 && existsSync(copied) && readdirSync(copied).length > 0) report.pass('backups copy attached files', copied);
  else report.fail('backups copy attached files', `${copied} is missing or empty`);
  if (existsSync(join(backups, 'profile', 'resume-guide.md')) && existsSync(join(backups, 'templates', 'resume.css'))) {
    report.pass('backups copy your profile and templates');
  } else report.fail('backups copy your profile and templates', `no profile or templates folder in ${backups}`);

  const logs = join(root, 'data', 'logs');
  if (existsSync(logs) && readdirSync(logs).some((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))) report.pass('the app writes its log', logs);
  else report.fail('the app writes its log', `no app-YYYY-MM-DD.log in ${logs}`);

  if (IS_WINDOWS) {
    const setup = runBat(root, 'setup.bat', ['-Quiet'], 60_000);
    const out = `${setup.stdout}${setup.stderr}`;
    if (setup.status !== 0 && out.includes('Run stop.bat first')) report.pass('setup.bat refuses to run while the app is running');
    else report.fail('setup.bat refuses to run while the app is running', `exit code ${setup.status}`);
  }
} catch (err) {
  report.fail('the checks ran to the end', (err as Error).message);
}

const stopped = await stopApp(root, port);
if (stopped.includes('Job Registry stopped.') && (await waitFor(async () => !(await healthy(port)), 15_000))) report.pass('the app stops');
else report.fail('the app stops', stopped.trim() || 'it still answers after 15 seconds');

if (IS_WINDOWS) {
  const again = await stopApp(root, port);
  if (again.includes("wasn't running")) report.pass("stop.bat says when the app wasn't running");
  else report.fail("stop.bat says when the app wasn't running", again.trim());
}

// A mistake in settings.json stops the app with a plain message, in plain characters.
writeTestSettings(root, {
  ...testSettings({ port }),
  statuses: [{ id: 'saved', label: '', closed: false, order: 10, setsAppliedDate: false }],
});
const broken = IS_WINDOWS
  ? runBat(root, 'start.bat', ['--no-browser'], 60_000)
  : spawnSync(process.execPath, ['server/main.ts'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
const errorFile = join(root, 'data', 'logs', 'startup-error.txt');
const message = existsSync(errorFile) ? readFileSync(errorFile, 'utf8') : '';
if (broken.status !== 0 && message.includes('settings.json') && [...message].every((c) => c.charCodeAt(0) < 128)) {
  report.pass('a broken settings file stops the app with a plain message', message.trim().split(/\r?\n/)[0]);
} else report.fail('a broken settings file stops the app with a plain message', `exit code ${broken.status}; "${message.trim().slice(0, 200)}"`);
if (await healthy(port)) await stopApp(root, port);
writeTestSettings(root, testSettings({ port }));

// Running setup.bat again later (an update) keeps your jobs. Windows only: it installs everything again.
if (IS_WINDOWS) {
  const setup = runBat(root, 'setup.bat', ['-Quiet'], 1_800_000);
  const restarted = setup.status === 0 && startApp(root).code === 0 && (await waitFor(() => healthy(port), 30_000));
  const jobs = restarted ? await api(port, 'GET', '/jobs?status=all') : null;
  const kept = (jobs?.json ?? []).some((j: { company?: string }) => j.company === 'Atlassian');
  if (kept) report.pass('setup.bat run again keeps your jobs');
  else report.fail('setup.bat run again keeps your jobs', setup.status === 0 ? 'the job is gone, or the app did not start' : `setup.bat exit code ${setup.status}`);
  await stopApp(root, port);
}

process.exit(report.finish());
