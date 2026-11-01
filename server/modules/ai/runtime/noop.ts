// For an AI server you run yourself (Ollama, LM Studio, a custom one): the
// app only checks that it answers. It never starts or stops it.

import { AiUnavailableError } from '../../../core/errors.ts';
import type { AiProvider } from '../provider.ts';
import { runtimeState, type ModelRuntime } from '../runtime.ts';

// provider gives the AI in use's provider each time, so the check follows a switch.
export function createNoopRuntime(provider: () => AiProvider): ModelRuntime {
  const state = runtimeState();
  return {
    async ensureRunning() {
      const health = await provider().health();
      if (!health.ok) {
        const message = health.detail ?? "The AI server didn't answer.";
        state.set('error', message);
        throw new AiUnavailableError(message);
      }
      state.set('ready');
    },
    touch() {},
    stopNow() {},
    async stop() {
      state.set('off');
    },
    state: state.get,
    detail: state.detail,
    onStateChange: state.on,
  };
}
