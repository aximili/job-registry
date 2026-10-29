// The ModelRuntime port: starting and stopping the AI program itself, when the
// app runs it (llama-server), or just checking it's there when you run it
// (Ollama, LM Studio). See docs/architecture.md §6.2. "busy" isn't a runtime
// state: the AI service adds it while a task runs.

export type RuntimeState = 'off' | 'starting' | 'ready' | 'error';

export interface ModelRuntime {
  // Starts the program if needed and waits until it answers. Background
  // work (an email check, reading saved ads at start-up) says so: then a
  // program that opens a window, such as your start_bonsai.bat, is never
  // opened. A window shouldn't pop up when you didn't do anything.
  ensureRunning(signal?: AbortSignal, opts?: { background?: boolean }): Promise<void>;
  // Called after each task: restarts the idle timer.
  touch(): void;
  // Stops a program the app started. Never one you started yourself.
  stop(): Promise<void>;
  // The same, at once and without waiting: for a crash or the app exiting.
  stopNow(): void;
  state(): RuntimeState;
  // Why the state is "error", in a sentence.
  detail(): string | null;
  onStateChange(fn: (state: RuntimeState) => void): () => void;
}

// Shared by both runtimes: the current state, and who to tell when it changes.
export function runtimeState() {
  let state: RuntimeState = 'off';
  let detail: string | null = null;
  const listeners = new Set<(state: RuntimeState) => void>();
  return {
    get: () => state,
    detail: () => detail,
    set(next: RuntimeState, why: string | null = null) {
      const changed = next !== state || why !== detail;
      state = next;
      detail = why;
      if (changed) for (const fn of [...listeners]) fn(next);
    },
    on(fn: (state: RuntimeState) => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
