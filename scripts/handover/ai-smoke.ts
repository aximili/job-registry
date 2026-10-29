// Handover step: the AI in the test copy. The test copy's app starts its own
// llama-server (from the real ai folder, on port 8081, with a small context),
// so the Bonsai 2 that the agent runs on port 8080 is never stopped.
// It checks that the app starts it, reads an ad with it, stops it after the
// idle time, and stops it when the app stops or is killed.
//
//   node scripts\handover\ai-smoke.ts            (15 to 25 minutes)
//   --no-idle   skips the 1-minute idle stop

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { factCheck } from '../../shared/fact-check.ts';
import {
  api,
  createReport,
  hasFlag,
  healthy,
  IS_WINDOWS,
  isTestCopy,
  killPortListeners,
  listenerPids,
  REAL_ROOT,
  runCommand,
  startApp,
  stopApp,
  testPort,
  testRoot,
  testSettings,
  waitFor,
  writeTestSettings,
} from './lib.ts';

const report = createReport('ai-smoke');
const root = testRoot();
const port = testPort();
const llamaPort = Number(process.env.JR_LLAMA_PORT ?? 8081);
// The real llama-server and model, unless the Mac tests give a fake one.
const exe = process.env.JR_LLAMA_EXE ?? join(REAL_ROOT, 'ai', 'llama.cpp', 'llama-server.exe');
const model = join(REAL_ROOT, 'ai', 'models', 'Ternary-Bonsai-2-27B-PQ2_0.gguf');
const fakeArgs = process.env.JR_LLAMA_ARGS ? (JSON.parse(process.env.JR_LLAMA_ARGS) as string[]) : null;

async function llamaUp(): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${llamaPort}/health`, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    return false;
  }
}

if (!isTestCopy(root)) {
  report.fail('the test copy is there', `${root} isn't a test copy. Run make-test-copy.ts first.`);
  process.exit(report.finish());
}
if (!existsSync(exe) || (!fakeArgs && !existsSync(model))) {
  report.fail('the AI is downloaded', `${existsSync(exe) ? model : exe} is missing. Run download-ai.bat in ${REAL_ROOT}.`);
  process.exit(report.finish());
}
if ((await healthy(port)) || (await llamaUp())) {
  report.fail('the test ports are free', `something already answers on port ${port} or ${llamaPort}`);
  process.exit(report.finish());
}

const settings = testSettings({ port, llama: { exe, model, port: llamaPort } }) as { ai: { managed: { args: string[] } } };
if (fakeArgs) settings.ai.managed.args = fakeArgs;
writeTestSettings(root, settings);
// A sample master profile, in the test copy only, so ratings and resumes can be tried.
mkdirSync(join(root, 'profile'), { recursive: true });
copyFileSync(join(REAL_ROOT, 'scripts', 'handover', 'sample-profile.md'), join(root, 'profile', 'master-profile.md'));
const profileText = readFileSync(join(root, 'profile', 'master-profile.md'), 'utf8');

// Graphics memory, in MiB (Windows, NVIDIA): "used" or "free".
function gpuMemory(which: 'used' | 'free'): number | null {
  const res = runCommand(`nvidia-smi --query-gpu=memory.${which} --format=csv,noheader,nounits`, REAL_ROOT, 30_000);
  const value = Number(res.stdout.trim().split(/\r?\n/)[0]);
  return res.status === 0 && Number.isFinite(value) ? value : null;
}

if (IS_WINDOWS) {
  // The second llama-server needs room beside the Bonsai 2 you run on.
  const free = gpuMemory('free');
  if (free !== null && free < 9000) {
    report.fail('there is room on the graphics card', `${free} MiB free, 9000 needed. Close games and other GPU apps (needs you).`);
    process.exit(report.finish());
  }
  report.info('free graphics memory', `${free ?? '?'} MiB`);
}

// The model file, checked against the SHA-256 that download-ai.ps1 pins. Read only.
if (!fakeArgs) {
  const pinned = /Name\s*=\s*'Ternary-Bonsai-2-27B-PQ2_0\.gguf'[\s\S]*?Sha256\s*=\s*'([0-9a-fA-F]{64})'/.exec(
    readFileSync(join(REAL_ROOT, 'scripts', 'download-ai.ps1'), 'utf8'),
  )?.[1];
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(model)) hash.update(chunk as Buffer);
  const actual = hash.digest('hex');
  if (pinned && actual.toLowerCase() === pinned.toLowerCase()) report.pass('the model file matches its pinned SHA-256');
  else report.fail('the model file matches its pinned SHA-256', `got ${actual}, expected ${pinned ?? '(not found in download-ai.ps1)'}. Run download-ai.bat (needs you).`);
}

async function start(): Promise<boolean> {
  const started = startApp(root);
  return started.code === 0 && (await waitFor(() => healthy(port), 30_000));
}

if (await start()) report.pass('the app starts', `port ${port}`);
else {
  report.fail('the app starts', `no answer on port ${port} within 30 seconds`);
  process.exit(report.finish());
}

try {
  const began = Date.now();
  const test = await api(port, 'POST', '/ai/test', {}, 300_000);
  if (test.json?.ok) report.pass('the app starts llama-server and the AI answers', `${Math.round((Date.now() - began) / 1000)} s to start and answer`);
  else report.fail('the app starts llama-server and the AI answers', test.json?.detail ?? `status ${test.status}`);

  if (await llamaUp()) report.pass(`llama-server answers on port ${llamaPort}`);
  else report.fail(`llama-server answers on port ${llamaPort}`, 'no answer');
  const memoryWhileRunning = IS_WINDOWS ? gpuMemory('used') : null;
  if (IS_WINDOWS) {
    const llamaLog = join(root, 'data', 'logs', 'llama.log');
    const text = existsSync(llamaLog) ? readFileSync(llamaLog, 'utf8') : '';
    if (/CUDA/i.test(text)) report.pass("llama-server's log names the graphics card (CUDA)", llamaLog);
    else report.fail("llama-server's log names the graphics card (CUDA)", `no "CUDA" in ${llamaLog}`);
  }

  const ad = readFileSync(join(REAL_ROOT, 'tests', 'fixtures', 'ads', '01-seek-example.txt'), 'utf8');
  const expected = JSON.parse(readFileSync(join(REAL_ROOT, 'tests', 'fixtures', 'ads', '01-seek-example.expected.json'), 'utf8')) as { title: string; company: string };
  const saved = await api(port, 'POST', '/jobs', {
    capture: { sourceUrl: null, canonicalUrl: null, sourceSite: 'pasted', externalId: null, jdText: ad, capturedAt: new Date().toISOString() },
    decision: 'new',
  });
  const id = saved.json?.job?.id as number | undefined;
  const readStart = Date.now();
  let job: { parseState?: string; parseError?: string | null; title?: string | null; company?: string | null } = {};
  const read = id !== undefined && (await waitFor(async () => {
    job = (await api(port, 'GET', `/jobs/${id}`)).json ?? {};
    return job.parseState === 'done' || job.parseState === 'failed';
  }, 300_000));
  const secs = Math.round((Date.now() - readStart) / 1000);
  if (read && job.parseState === 'done' && secs <= 60) {
    report.pass('the AI reads a saved ad', `${secs} s (the plan's goal is about 20 s); role "${job.title}", company "${job.company}"`);
    const same = job.title === expected.title && job.company === expected.company;
    report.info('the ad was read as expected', same ? 'role and company match' : `expected "${expected.title}" at "${expected.company}"`);
  } else {
    report.fail('the AI reads a saved ad', job.parseError ?? `"${job.parseState ?? 'not saved'}" after ${secs} s (60 s at most)`);
  }

  // A match rating against the sample profile, as the extension asks for one.
  const rated = await api(port, 'POST', '/ratings', {
    capture: { sourceUrl: null, canonicalUrl: null, sourceSite: 'pasted', externalId: null, jdText: ad, capturedAt: new Date().toISOString() },
  }, 300_000);
  if (rated.json?.rating?.verdict) report.pass('the AI rates a job against the profile', `${rated.json.rating.verdict}, ${rated.json.rating.score}`);
  else report.fail('the AI rates a job against the profile', rated.json?.reason ?? rated.json?.error?.message ?? `status ${rated.status}`);

  // A resume, written from the sample profile, as the editor's Generate does.
  if (id !== undefined) {
    const writeStart = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/jobs/${id}/documents/generate`, {
      method: 'POST',
      headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'resume' }),
      signal: AbortSignal.timeout(900_000),
    });
    const lines = (await res.text()).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as { kind: string; text?: string; message?: string });
    const draft = lines.filter((l) => l.kind === 'text').map((l) => l.text ?? '').join('');
    const last = lines.at(-1);
    const wrote = Math.round((Date.now() - writeStart) / 1000);
    if (res.status === 200 && last?.kind === 'done' && draft.trim().length > 0) report.pass('the AI writes a resume', `${wrote} s, ${draft.length} characters`);
    else report.fail('the AI writes a resume', last?.message ?? `status ${res.status}, last line "${last?.kind ?? 'none'}" after ${wrote} s`);
    if (/<\/?think>/i.test(draft)) report.fail('no thinking text in the resume', 'the draft has <think> in it');
    else report.pass('no thinking text in the resume');
    const flags = factCheck(draft, profileText);
    report.info('the fact-check on that resume', flags.length === 0 ? 'nothing flagged' : `not in the profile: ${flags.map((f) => f.text).join(', ')}`);

    const version = await api(port, 'POST', `/jobs/${id}/documents`, { kind: 'resume', markdown: draft || '# Resume', origin: 'generated' });
    const docx = version.json?.id ? await fetch(`http://127.0.0.1:${port}/api/v1/documents/${version.json.id}/export?format=docx`) : null;
    const bytes = docx ? Buffer.from(await docx.arrayBuffer()) : Buffer.alloc(0);
    if (docx?.status === 200 && bytes.subarray(0, 2).toString() === 'PK') report.pass('the resume exports as a .docx file', `${bytes.length} bytes`);
    else report.fail('the resume exports as a .docx file', `status ${docx?.status ?? '-'}`);
  }

  if (hasFlag('no-idle')) report.info('the idle stop is skipped', '--no-idle');
  else {
    if (await waitFor(async () => !(await llamaUp()), 150_000)) report.pass('llama-server stops after 1 idle minute');
    else report.fail('llama-server stops after 1 idle minute', 'still answering after 150 seconds');
    if (IS_WINDOWS && memoryWhileRunning !== null) {
      const after = gpuMemory('used');
      const freed = after === null ? 0 : memoryWhileRunning - after;
      if (freed >= 1000) report.pass('the graphics memory comes back', `${freed} MiB freed`);
      else report.fail('the graphics memory comes back', `${memoryWhileRunning} MiB before, ${after ?? '?'} MiB after`);
    }
    const again = await api(port, 'POST', '/ai/test', {}, 300_000);
    if (again.json?.ok && (await llamaUp())) report.pass('llama-server starts again when it is needed');
    else report.fail('llama-server starts again when it is needed', again.json?.detail ?? `status ${again.status}`);
  }
} catch (err) {
  report.fail('the checks ran to the end', (err as Error).message);
}

await stopApp(root, port);
const appDown = await waitFor(async () => !(await healthy(port)), 20_000);
if (appDown && (await waitFor(async () => !(await llamaUp()), 30_000))) report.pass('stopping the app stops llama-server too');
else report.fail('stopping the app stops llama-server too', appDown ? `llama-server still answers on ${llamaPort}` : 'the app still answers');

// Killing the app (a crash, or ending it in Task Manager) must end llama-server too.
if (IS_WINDOWS) {
  if ((await start()) && (await api(port, 'POST', '/ai/test', {}, 300_000)).json?.ok) {
    // Only the app itself (no /T), so llama-server must end because the app did.
    const pid = listenerPids(port)[0];
    if (pid) spawnSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' });
    if (pid && (await waitFor(async () => !(await llamaUp()), 15_000))) report.pass('llama-server ends when the app is killed');
    else report.fail('llama-server ends when the app is killed', pid ? `llama-server still answers on ${llamaPort}` : 'no app process found');
  } else {
    report.fail('llama-server ends when the app is killed', 'the app or the AI did not start again');
    await stopApp(root, port);
  }
} else {
  report.info('killing the app is skipped', 'Windows only');
}

// A llama-server the app didn't start is used, and never stopped by the app.
// Anything left on the port first (from a failed check above) would make this pass falsely.
killPortListeners([llamaPort]);
await waitFor(async () => !(await llamaUp()), 15_000);
const ownArgs = settings.ai.managed.args;
const own = spawn(exe, ownArgs, { stdio: 'ignore' });
if (await waitFor(() => llamaUp(), 240_000)) {
  writeTestSettings(root, settings);
  if ((await start()) && (await api(port, 'POST', '/ai/test', {}, 300_000)).json?.ok) {
    await stopApp(root, port);
    await waitFor(async () => !(await healthy(port)), 20_000);
    await new Promise((r) => setTimeout(r, 3_000));
    if (await llamaUp()) report.pass("a llama-server the app didn't start is left running");
    else report.fail("a llama-server the app didn't start is left running", 'it stopped with the app');
  } else {
    report.fail("a llama-server the app didn't start is left running", 'the app or the AI test did not work');
    await stopApp(root, port);
  }
} else {
  report.fail("a llama-server the app didn't start is left running", 'the llama-server started for this check did not answer');
}
if (IS_WINDOWS && own.pid) spawnSync('taskkill', ['/F', '/T', '/PID', String(own.pid)], { stdio: 'ignore' });
else own.kill();
// Nothing is left holding graphics memory.
killPortListeners([port, llamaPort]);

process.exit(report.finish());
