// npm run eval:parse -- --ai "<name or id>": which saved AI it runs, and the
// one key its temporary copy gets.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Settings } from '../shared/contracts/index.ts';
import { findAi, prepareEvalConfig } from '../scripts/eval-ai.ts';
import { FAKE_PARSED } from './fakes/fake-ai-provider.ts';
import { freePort } from './helpers/test-app.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'jr-eval-test-'));
  dirs.push(dir);
  return dir;
};

// Bonsai 2 in use, plus two cloud AIs and a server of your own. The cloud
// addresses are ones where nothing listens: no test reaches a real provider.
const SAVED = {
  active: 'bonsai-2',
  saved: [
    { id: 'bonsai-2', name: 'Bonsai 2' },
    { id: 'claude-work', name: 'Claude (work)', preset: 'anthropic', baseUrl: 'http://127.0.0.1:9/v1', model: 'claude-sonnet-5-5' },
    { id: 'openai', name: 'OpenAI', preset: 'openai', baseUrl: 'http://127.0.0.1:9/v1', model: 'gpt-6.1-sol' },
    { id: 'my-server', name: 'My server', preset: 'custom', baseUrl: 'http://127.0.0.1:8090/v1', model: 'x' },
  ],
};
const SECRETS = {
  emailPassword: 'abcdefghijklmnop',
  aiKeys: { 'claude-work': ' sk-ant-work-key\n', openai: 'sk-openai-key', 'my-server': 'sk-my-server-key' },
};

// Your config folder (settings and secrets), and eval:parse's copy of your settings.
function setUp(settings: object = { ai: SAVED }, secrets: object | null = SECRETS) {
  const yours = join(temp(), 'config');
  mkdirSync(yours);
  writeFileSync(join(yours, 'settings.json'), JSON.stringify(settings));
  if (secrets) writeFileSync(join(yours, 'secrets.json'), JSON.stringify(secrets));
  const configDir = join(temp(), 'config');
  mkdirSync(configDir);
  copyFileSync(join(yours, 'settings.json'), join(configDir, 'settings.json'));
  return { yours, yourSecrets: join(yours, 'secrets.json'), configDir };
}
const copied = (configDir: string) => ({
  active: Settings.parse(JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf8'))).ai.active,
  secrets: existsSync(join(configDir, 'secrets.json')) ? JSON.parse(readFileSync(join(configDir, 'secrets.json'), 'utf8')) : null,
});

describe('eval:parse --ai: finding the AI', () => {
  const ai = Settings.parse({ ai: SAVED }).ai;

  it('finds a saved AI by its name, in any case', () => {
    expect(findAi(ai, 'claude (WORK)')?.id).toBe('claude-work');
    expect(findAi(ai, '  My Server ')?.id).toBe('my-server');
  });

  it('finds a saved AI by its id, in any case', () => {
    expect(findAi(ai, 'claude-work')?.id).toBe('claude-work');
    expect(findAi(ai, ' CLAUDE-Work ')?.id).toBe('claude-work');
    // A name with an en dash is hard to type in PowerShell; its id isn't.
    const dash = Settings.parse({ ai: { active: 'claude-mine', saved: [{ id: 'claude-mine', name: 'Claude – mine', preset: 'anthropic', baseUrl: 'http://127.0.0.1:9/v1' }] } }).ai;
    expect(findAi(dash, 'Claude-Mine')?.id).toBe('claude-mine');
  });

  it('a name comes before an id', () => {
    const tricky = Settings.parse({ ai: { active: 'a', saved: [{ id: 'a', name: 'b' }, { id: 'b', name: 'Other' }] } }).ai;
    expect(findAi(tricky, 'b')?.id).toBe('a');
  });

  it('finds nothing for a name no AI has', () => {
    expect(findAi(ai, 'Gemini')).toBeNull();
  });
});

describe("eval:parse --ai: the run's own copy of your settings", () => {
  it('puts the AI you name in use, and copies its key and no other', () => {
    const { yourSecrets, configDir } = setUp();
    const before = readFileSync(yourSecrets, 'utf8');
    const result = prepareEvalConfig({ configDir, yourSecrets, wanted: 'claude (work)' });
    expect(result).toMatchObject({ ai: { id: 'claude-work', name: 'Claude (work)' } });
    // The key as the app would send it: no spaces or newline.
    expect(copied(configDir)).toEqual({ active: 'claude-work', secrets: { emailPassword: null, aiKeys: { 'claude-work': 'sk-ant-work-key' } } });
    expect(readFileSync(yourSecrets, 'utf8')).toBe(before);
  });

  it('works with the id too', () => {
    const { yourSecrets, configDir } = setUp();
    expect(prepareEvalConfig({ configDir, yourSecrets, wanted: 'openai' })).toMatchObject({ ai: { id: 'openai' } });
    expect(copied(configDir)).toEqual({ active: 'openai', secrets: { emailPassword: null, aiKeys: { openai: 'sk-openai-key' } } });
  });

  it('without --ai, runs the AI in use, with its key', () => {
    const { yourSecrets, configDir } = setUp({ ai: { ...SAVED, active: 'my-server' } });
    expect(prepareEvalConfig({ configDir, yourSecrets })).toMatchObject({ ai: { id: 'my-server' } });
    expect(copied(configDir)).toEqual({ active: 'my-server', secrets: { emailPassword: null, aiKeys: { 'my-server': 'sk-my-server-key' } } });
  });

  it('an AI that takes no key gets no secrets file, even when yours has keys', () => {
    const { yourSecrets, configDir } = setUp();
    expect(prepareEvalConfig({ configDir, yourSecrets })).toMatchObject({ ai: { id: 'bonsai-2' } });
    expect(copied(configDir)).toEqual({ active: 'bonsai-2', secrets: null });
  });

  it('an AI with no key saved gets no secrets file', () => {
    const { yourSecrets, configDir } = setUp({ ai: SAVED }, null);
    expect(prepareEvalConfig({ configDir, yourSecrets, wanted: 'OpenAI' })).toMatchObject({ ai: { id: 'openai' } });
    expect(copied(configDir).secrets).toBeNull();
  });

  it('an unknown name lists the saved names with their ids, and changes nothing', () => {
    const { yourSecrets, configDir } = setUp();
    const result = prepareEvalConfig({ configDir, yourSecrets, wanted: 'Gemini' });
    expect(result).toEqual({
      problem: `There's no saved AI called "Gemini". Your saved AIs: "Bonsai 2" (bonsai-2), "Claude (work)" (claude-work), "OpenAI" (openai), "My server" (my-server).`,
    });
    expect(copied(configDir)).toEqual({ active: 'bonsai-2', secrets: null });
  });
});

describe('eval:parse --ai, run for real', () => {
  // Leftover temporary folders: the run's copy (with the key) must be gone.
  const leftovers = (dir: string) => readdirSync(dir).filter((name) => name.startsWith('jr-eval-'));

  // A run of eval:parse with --ai openai, against a stand-in for the cloud AI
  // on this computer. The stand-in reads every ad as FAKE_PARSED and keeps
  // each request's key. With hold, it keeps the first request waiting until
  // letGo(), so a test can look at the run's copy while it runs. The run has
  // its own temporary folder (TMPDIR), and the ad and your config are temporary too.
  async function run(o: { hold?: boolean } = {}) {
    const keys: (string | undefined)[] = [];
    const held: ServerResponse[] = [];
    let holding = o.hold ?? false;
    let reached!: () => void;
    const atAi = new Promise<void>((r) => (reached = r));
    const answer = (res: ServerResponse) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'x',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(FAKE_PARSED) }, finish_reason: 'stop' }],
        }),
      );
    };
    const port = await freePort();
    const server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        if (req.url !== '/v1/chat/completions') return answer(res);
        keys.push(req.headers.authorization);
        reached();
        if (holding) held.push(res);
        else answer(res);
      });
    }).listen(port, '127.0.0.1');
    const settings = { ai: { ...SAVED, saved: SAVED.saved.map((one) => (one.id === 'openai' ? { ...one, baseUrl: `http://127.0.0.1:${port}/v1` } : one)) } };
    const { yours, yourSecrets } = setUp(settings);
    const ads = temp();
    writeFileSync(join(ads, 'one.txt'), 'Senior Engineer at Atlassian, Sydney. Hybrid.');
    writeFileSync(join(ads, 'one.expected.json'), JSON.stringify({ title: FAKE_PARSED.title, company: FAKE_PARSED.company }));
    const tmp = temp();
    // Not spawnSync: the stand-in runs in this process, so it must stay free to answer.
    const child = spawn(process.execPath, ['scripts/eval-parse.ts', '--settings', join(yours, 'settings.json'), '--ads', ads, '--ai', 'openai'], {
      env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const closed = new Promise<number | null>((r) => child.on('close', (code) => r(code)));
    return {
      port,
      keys,
      tmp,
      child,
      yourSecrets,
      closed,
      out: () => out,
      // Waits for the first request, or fails with the run's output if it ended first.
      reachedAi: () => Promise.race([atAi, closed.then(() => Promise.reject(new Error(`the run ended first:\n${out}`)))]),
      letGo() {
        holding = false;
        for (const res of held.splice(0)) answer(res);
      },
      stop() {
        child.kill('SIGKILL');
        server.closeAllConnections();
        server.close();
      },
    };
  }

  it('an unknown name lists the saved names and exits 1, leaving nothing behind', () => {
    const { yours } = setUp();
    const tmp = temp();
    const res = spawnSync(process.execPath, ['scripts/eval-parse.ts', '--settings', join(yours, 'settings.json'), '--ai', 'Gemini'], {
      env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(res.status, res.stdout + res.stderr).toBe(1);
    expect(res.stdout).toContain(`There's no saved AI called "Gemini". Your saved AIs: "Bonsai 2" (bonsai-2), "Claude (work)" (claude-work), "OpenAI" (openai), "My server" (my-server).`);
    expect(leftovers(tmp)).toEqual([]);
  });

  it('runs the AI you name with its own key, then deletes the copy', { timeout: 60_000 }, async () => {
    const r = await run();
    try {
      const before = readFileSync(r.yourSecrets, 'utf8');
      expect(await r.closed, r.out()).toBe(0);
      expect(r.out()).toContain(`AI: OpenAI (openai) at http://127.0.0.1:${r.port}/v1, model gpt-6.1-sol`);
      expect(r.out()).toContain('one: 2/2 right');
      expect(r.keys.length).toBeGreaterThan(0);
      expect(new Set(r.keys)).toEqual(new Set(['Bearer sk-openai-key']));
      expect(r.out()).not.toContain('sk-openai-key');
      expect(leftovers(r.tmp)).toEqual([]);
      expect(readFileSync(r.yourSecrets, 'utf8')).toBe(before);
    } finally {
      r.stop();
    }
  });

  // The app copies its starter guides and templates in wherever one is
  // missing. Here that's the run's own copy, never the app folder's profile\ or templates\.
  it('keeps the starter guides and templates in its own copy', { timeout: 60_000 }, async () => {
    const r = await run({ hold: true });
    try {
      await r.reachedAi();
      const [copy] = leftovers(r.tmp);
      expect(copy).toBeDefined();
      expect(existsSync(join(r.tmp, copy!, 'profile', 'resume-guide.md'))).toBe(true);
      expect(existsSync(join(r.tmp, copy!, 'templates', 'resume.css'))).toBe(true);
      r.letGo();
      expect(await r.closed, r.out()).toBe(0);
      expect(leftovers(r.tmp)).toEqual([]);
    } finally {
      r.stop();
    }
  });

  // Ctrl+C, closing the terminal window, or an ordinary kill. (A forced kill
  // can't be caught by any program.) Windows has no such signals to send.
  describe.skipIf(process.platform === 'win32')('stopped part-way', () => {
    it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)('by %s, it still deletes its copy with the key', { timeout: 60_000 }, async (signal) => {
      const r = await run({ hold: true });
      try {
        await r.reachedAi();
        const [copy] = leftovers(r.tmp);
        expect(existsSync(join(r.tmp, copy!, 'config', 'secrets.json'))).toBe(true);
        r.child.kill(signal);
        await r.closed;
        expect(leftovers(r.tmp)).toEqual([]);
      } finally {
        r.stop();
      }
    });
  });
});
