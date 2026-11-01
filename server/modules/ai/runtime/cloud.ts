// For an AI on the internet (Claude, OpenAI and the others): there's no
// program to start, stop or check, so it's always ready. A request that
// fails (a refused key, a usage limit) shows in the pill through the AI
// service, the same way a failed task on any AI does.

import type { ModelRuntime } from '../runtime.ts';

export function createCloudRuntime(): ModelRuntime {
  return {
    async ensureRunning() {},
    touch() {},
    async stop() {},
    stopNow() {},
    state: () => 'ready',
    detail: () => null,
    // Its state never changes.
    onStateChange: () => () => {},
  };
}
