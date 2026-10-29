// A ModelRuntime for tests: no process, just a state you can set and count.

import { AiUnavailableError } from '../../server/core/errors.ts';
import { runtimeState, type ModelRuntime, type RuntimeState } from '../../server/modules/ai/runtime.ts';

export class FakeRuntime implements ModelRuntime {
  failWith: string | null = null;
  touches = 0;
  stops = 0;
  starts = 0;
  // Whether each call was background work, in order.
  background: boolean[] = [];
  private readonly s = runtimeState();

  async ensureRunning(_signal?: AbortSignal, opts: { background?: boolean } = {}): Promise<void> {
    this.background.push(opts.background ?? false);
    if (this.failWith) {
      this.s.set('error', this.failWith);
      throw new AiUnavailableError(this.failWith);
    }
    if (this.s.get() !== 'ready') {
      this.starts++;
      this.s.set('starting');
      this.s.set('ready');
    }
  }

  touch(): void {
    this.touches++;
  }

  stopNow(): void {
    this.stops++;
    this.s.set('off');
  }

  async stop(): Promise<void> {
    this.stops++;
    this.s.set('off');
  }

  state(): RuntimeState {
    return this.s.get();
  }

  detail(): string | null {
    return this.s.detail();
  }

  onStateChange(fn: (state: RuntimeState) => void): () => void {
    return this.s.on(fn);
  }
}
