import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../../shared/contracts/index.ts';
import { FakeAiProvider } from '../../../../tests/fakes/fake-ai-provider.ts';
import { AiUnavailableError } from '../../../core/errors.ts';
import { createNoopRuntime } from './noop.ts';

describe('noop runtime (a server you run yourself)', () => {
  it('checks the server, and is ready when it answers', async () => {
    const runtime = createNoopRuntime(new FakeAiProvider(), () => DEFAULT_SETTINGS.ai);
    expect(runtime.state()).toBe('off');
    await runtime.ensureRunning();
    expect(runtime.state()).toBe('ready');
  });

  it('passes on a plain error when the server is down, and never stops it', async () => {
    const provider = new FakeAiProvider();
    provider.down = true;
    const runtime = createNoopRuntime(provider, () => DEFAULT_SETTINGS.ai);
    const err = await runtime.ensureRunning().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect((err as Error).message).toContain("Can't reach the AI");
    expect(runtime.state()).toBe('error');
    expect(runtime.detail()).toContain("Can't reach the AI");
    await runtime.stop();
    expect(runtime.state()).toBe('off');
  });
});
