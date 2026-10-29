// Builds the real app (real wiring, in-memory database) for API tests.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import type { Settings } from '../../shared/contracts/index.ts';
import { buildApp, type App, type Fakes } from '../../server/app.ts';
import { resolvePaths, type Clock } from '../../server/core/config.ts';
import type { Logger } from '../../server/core/logger.ts';
import { FakeAiProvider } from '../fakes/fake-ai-provider.ts';
import { FakeMailSource } from '../fakes/fake-mail-source.ts';
import { FakeRuntime } from '../fakes/fake-runtime.ts';

export const TEST_PORT = 4777;
export const TEST_ORIGIN = `http://127.0.0.1:${TEST_PORT}`;

export type TestResponse = { status: number; body: any; headers: Record<string, unknown> };

export type TestApp = App & {
  root: string;
  fakes: Fakes;
  request(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<TestResponse>;
  cleanup(): Promise<void>;
};

// A free port for tests that really listen (for example, live events).
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export async function createTestApp(
  opts: {
    now?: Clock;
    fetch?: typeof fetch;
    settings?: Partial<Settings>;
    // Written to config/secrets.json, as you'd save them in Settings.
    secrets?: { emailPassword: string | null };
    port?: number;
    fakes?: Partial<Fakes>;
    // Use the app's own runtime choice (llama-server or a server you run),
    // for the tests of that choice. The AI provider is still a fake.
    realRuntime?: boolean;
    // To read what the app logs. Silent unless given.
    logger?: Logger;
  } = {},
): Promise<TestApp> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jr-app-')));
  const paths = resolvePaths(root, { db: ':memory:' });
  if (opts.settings) {
    mkdirSync(paths.config, { recursive: true });
    writeFileSync(paths.settings, JSON.stringify(opts.settings));
  }
  if (opts.secrets) {
    mkdirSync(paths.config, { recursive: true });
    writeFileSync(paths.secrets, JSON.stringify(opts.secrets));
  }
  // Tests never talk to a real AI or a real mailbox: fakes unless given others.
  const fakes: Fakes = {
    ai: opts.fakes?.ai ?? new FakeAiProvider(),
    runtime: opts.fakes?.runtime ?? new FakeRuntime(),
    mail: opts.fakes?.mail ?? new FakeMailSource(),
  };
  const wiring: Partial<Fakes> = opts.realRuntime ? { ai: fakes.ai, mail: fakes.mail } : fakes;
  const app = await buildApp({
    paths,
    port: opts.port ?? TEST_PORT,
    logger: opts.logger ?? pino({ level: 'silent' }),
    now: opts.now,
    fetch: opts.fetch,
    version: '0.0.0-test',
  }, wiring);

  async function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const isWrite = !['GET', 'HEAD'].includes(method.toUpperCase());
    const res = await app.http.inject({
      method: method as 'GET',
      url,
      payload: body === undefined ? undefined : typeof body === 'string' ? body : (body as object),
      headers: { host: `127.0.0.1:${TEST_PORT}`, ...(isWrite ? { origin: TEST_ORIGIN } : {}), ...headers },
    });
    let parsed: unknown = res.body;
    try {
      parsed = res.json();
    } catch {
      // Not JSON; keep the text.
    }
    return { status: res.statusCode, body: parsed, headers: res.headers };
  }

  return {
    ...app,
    root,
    fakes,
    request,
    async cleanup() {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
