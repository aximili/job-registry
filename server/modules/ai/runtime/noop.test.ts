import { describe, expect, it } from 'vitest';
import { FakeAiProvider } from '../../../../tests/fakes/fake-ai-provider.ts';
import { AiUnavailableError } from '../../../core/errors.ts';
import { createCloudRuntime } from './cloud.ts';
import { createNoopRuntime } from './noop.ts';

describe('noop runtime (a server you run yourself)', () => {
  it('checks the server, and is ready when it answers', async () => {
    const runtime = createNoopRuntime(() => new FakeAiProvider());
    expect(runtime.state()).toBe('off');
    await runtime.ensureRunning();
    expect(runtime.state()).toBe('ready');
  });

  it('passes on a plain error when the server is down, and never stops it', async () => {
    const provider = new FakeAiProvider();
    provider.down = true;
    const runtime = createNoopRuntime(() => provider);
    const err = await runtime.ensureRunning().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect((err as Error).message).toContain("Can't reach the AI");
    expect(runtime.state()).toBe('error');
    expect(runtime.detail()).toContain("Can't reach the AI");
    await runtime.stop();
    expect(runtime.state()).toBe('off');
  });

  it('asks the provider of the AI in use each time, so it follows a switch', async () => {
    const first = new FakeAiProvider();
    const second = new FakeAiProvider();
    second.down = true;
    let provider = first;
    const runtime = createNoopRuntime(() => provider);
    await runtime.ensureRunning();
    provider = second;
    await expect(runtime.ensureRunning()).rejects.toThrow("Can't reach the AI");
  });
});

describe('cloud runtime (an AI on the internet)', () => {
  it('has no program to start or check: ready at once, without asking the AI anything', async () => {
    const runtime = createCloudRuntime();
    expect(runtime.state()).toBe('ready');
    await runtime.ensureRunning(undefined, { background: true });
    await runtime.stop();
    runtime.stopNow();
    expect(runtime.state()).toBe('ready');
    expect(runtime.detail()).toBeNull();
  });
});
