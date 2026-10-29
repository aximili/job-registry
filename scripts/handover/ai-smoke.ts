// Handover step: the AI in the test copy. It tries the AI that your settings
// use (Settings -> AI):
// - An AI server you run yourself (such as your own Bonsai 2): the test copy
//   uses it with your AI settings, and checks that the app leaves it running.
// - Bonsai 2 started by the app: the test copy starts its own llama-server
//   (the same program and model, on port 8081, with a small context), so the
//   Bonsai 2 that the agent runs on port 8080 is never stopped. It also checks
//   that the app stops it after the idle time, and when the app stops or is
//   killed.
// Either way it reads an ad, rates a job, gives a job card a quick mark and
// writes a resume with it.
//
//   node scripts\handover\ai-smoke.ts            (5 to 25 minutes)
//   --no-idle   skips the 1-minute idle stop

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { factCheck } from '../../shared/fact-check.ts';
import {
  aiServerAnswers,
  api,
  appAi,
  createReport,
  hasFlag,
  healthy,
  IS_WINDOWS,
  isTestCopy,
  killPortListeners,
  listenerPids,
  readRealSettings,
  REAL_ROOT,
  runCommand,
  startApp,
  stopApp,
  testPort,
  testRoot,
  testSettings,
  waitFor,
  writeTestSettings,
  type AppAi,
} from './lib.ts';

const report = createReport('ai-smoke');
const root = testRoot();
const port = testPort();
const llamaPort = Number(process.env.JR_LLAMA_PORT ?? 8081);
const fakeArgs = process.env.JR_LLAMA_ARGS ? (JSON.parse(process.env.JR_LLAMA_ARGS) as string[]) : null;
const MODEL_NAME = 'Ternary-Bonsai-2-27B-PQ2_0.gguf';

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
const real = readRealSettings();
if (!real.settings) {
  report.fail('your config\\settings.json is valid', real.error ?? 'it did not load');
  process.exit(report.finish());
}
// The Mac tests give a fake llama-server instead.
const target: AppAi = process.env.JR_LLAMA_EXE ? { kind: 'managed', exe: process.env.JR_LLAMA_EXE, model: null } : appAi(real.settings.ai);
const own = target.kind === 'managed';
const exe = target.kind === 'managed' ? target.exe : '';
const model = target.kind === 'managed' ? target.model : null;

let settings: { ai: { managed: { args: string[] } } };
if (target.kind === 'external') {
  report.info('the AI used', `your own AI server at ${target.baseUrl}`);
  if (await aiServerAnswers(target.baseUrl)) report.pass('your AI server answers');
  else {
    report.fail('your AI server answers', `nothing answers at ${target.baseUrl}. Start it, or change Settings -> AI (needs you).`);
    process.exit(report.finish());
  }
  if (await healthy(port)) {
    report.fail('the test ports are free', `something already answers on port ${port}`);
    process.exit(report.finish());
  }
  settings = testSettings({ port, external: real.settings.ai }) as typeof settings;
} else {
  report.info('the AI used', `Bonsai 2 started by the app (${exe}), as its own llama-server on port ${llamaPort}`);
  if (!existsSync(exe) || (!fakeArgs && (!model || !existsSync(model)))) {
    const missing = existsSync(exe) ? (model ?? 'the model (no -m in Settings -> AI -> Arguments)') : exe;
    report.fail('the AI is downloaded', `${missing} is missing. Run download-ai.bat in ${REAL_ROOT}, or point the app at the Bonsai 2 you run yourself (needs you).`);
    process.exit(report.finish());
  }
  if ((await healthy(port)) || (await llamaUp())) {
    report.fail('the test ports are free', `something already answers on port ${port} or ${llamaPort}`);
    process.exit(report.finish());
  }
  settings = testSettings({ port, llama: { exe, model: model ?? '', port: llamaPort } }) as typeof settings;
  if (fakeArgs) settings.ai.managed.args = fakeArgs;
}
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

if (own && IS_WINDOWS) {
  // The second llama-server needs room beside the Bonsai 2 you run on.
  const free = gpuMemory('free');
  if (free !== null && free < 9000) {
    report.fail('there is room on the graphics card', `${free} MiB free, 9000 needed. Close games and other GPU apps (needs you).`);
    process.exit(report.finish());
  }
  report.info('free graphics memory', `${free ?? '?'} MiB`);
}

// The model file, checked against the SHA-256 that download-ai.ps1 pins. Read only.
if (own && !fakeArgs && model) {
  if (basename(model) !== MODEL_NAME) report.info('the model file is not checked', `${basename(model)} isn't the model download-ai.bat pins`);
  else {
    const pinned = /Name\s*=\s*'Ternary-Bonsai-2-27B-PQ2_0\.gguf'[\s\S]*?Sha256\s*=\s*'([0-9a-fA-F]{64})'/.exec(
      readFileSync(join(REAL_ROOT, 'scripts', 'download-ai.ps1'), 'utf8'),
    )?.[1];
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(model)) hash.update(chunk as Buffer);
    const actual = hash.digest('hex');
    if (pinned && actual.toLowerCase() === pinned.toLowerCase()) report.pass('the model file matches its pinned SHA-256');
    else report.fail('the model file matches its pinned SHA-256', `got ${actual}, expected ${pinned ?? '(not found in download-ai.ps1)'}. Run download-ai.bat (needs you).`);
  }
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
  const answered = own ? 'the app starts llama-server and the AI answers' : 'the app reaches your AI server and it answers';
  if (test.json?.ok) report.pass(answered, `${Math.round((Date.now() - began) / 1000)} s to ${own ? 'start and ' : ''}answer`);
  else report.fail(answered, test.json?.detail ?? `status ${test.status}`);

  let memoryWhileRunning: number | null = null;
  if (own) {
    if (await llamaUp()) report.pass(`llama-server answers on port ${llamaPort}`);
    else report.fail(`llama-server answers on port ${llamaPort}`, 'no answer');
    memoryWhileRunning = IS_WINDOWS ? gpuMemory('used') : null;
    if (IS_WINDOWS) {
      const llamaLog = join(root, 'data', 'logs', 'llama.log');
      const text = existsSync(llamaLog) ? readFileSync(llamaLog, 'utf8') : '';
      if (/CUDA/i.test(text)) report.pass("llama-server's log names the graphics card (CUDA)", llamaLog);
      else report.fail("llama-server's log names the graphics card (CUDA)", `no "CUDA" in ${llamaLog}`);
    }
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

  // A quick mark from one job card, as the extension asks for one on a search
  // list. Its time is the time per card: a list has 20 or more.
  const cardStart = Date.now();
  const card = await api(port, 'POST', '/ratings/card', {
    card: {
      canonicalUrl: 'https://www.seek.com.au/job/81234567',
      sourceSite: 'seek',
      externalId: '81234567',
      title: expected.title,
      company: expected.company,
      location: 'Melbourne VIC (Hybrid)',
      text: 'This is a Full time job\n$120,000 - $135,000 per year + super\nTurn customer and network data into clear decisions. Strong SQL and Power BI.',
    },
  }, 300_000);
  const cardSecs = Math.round((Date.now() - cardStart) / 1000);
  const mark = card.json?.rating;
  if (mark?.verdict && cardSecs <= 30) report.pass('the AI gives a job card a quick mark', `${cardSecs} s per card; ${mark.verdict}, ${mark.score}`);
  else report.fail('the AI gives a job card a quick mark', mark?.verdict ? `${cardSecs} s for one card (30 s at most)` : card.json?.reason ?? card.json?.error?.message ?? `status ${card.status}`);

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

  // The idle stop is only for a llama-server the app started: it never stops a server you run.
  if (own && hasFlag('no-idle')) report.info('the idle stop is skipped', '--no-idle');
  else if (own) {
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

if (target.kind === 'external') {
  // Your AI server (and the agent on it) carries on after the app stops.
  await new Promise((r) => setTimeout(r, 3_000));
  if (await aiServerAnswers(target.baseUrl)) report.pass('stopping the app leaves your AI server running');
  else report.fail('stopping the app leaves your AI server running', `nothing answers at ${target.baseUrl} after the app stopped`);
  if (!appDown) report.fail('the app stops', `it still answers on port ${port}`);
  killPortListeners([port]);
  process.exit(report.finish());
}

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
const left = spawn(exe, ownArgs, { stdio: 'ignore' });
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
if (IS_WINDOWS && left.pid) spawnSync('taskkill', ['/F', '/T', '/PID', String(left.pid)], { stdio: 'ignore' });
else left.kill();
// Nothing is left holding graphics memory.
killPortListeners([port, llamaPort]);

process.exit(report.finish());
