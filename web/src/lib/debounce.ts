// Waits until the changes stop for ms, then runs the last one. One run at a
// time: a later run waits for the one running, so the last change wins. A
// run that fails doesn't stop the next (the run says why itself). flush()
// runs a waiting change at once, for a page that's going away. settled()
// does too, and resolves once every run has ended: the editor saves your
// brief's changes first, then writes with it.
// Settings → AI's writing AI saves this way: on Windows, an arrow key moves
// a closed list, so arrowing through it saves once, the last choice.
export type Debounced<T> = ((value: T) => void) & { flush: () => void; settled: () => Promise<void> };

export function debounceLatest<T>(run: (value: T) => Promise<void>, ms: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The last change, while its time hasn't come; then while a run goes on.
  let waiting: { value: T } | null = null;
  let due: { value: T } | null = null;
  let running = false;
  // Who's waiting for every run to end.
  let idle: (() => void)[] = [];

  function wakeIdle() {
    if (running || due || waiting) return;
    const all = idle;
    idle = [];
    for (const done of all) done();
  }

  // Starts the due change now, unless a run is going: then straight after it.
  function next() {
    if (running || !due) return;
    const { value } = due;
    due = null;
    running = true;
    void (async () => {
      try {
        await run(value);
      } catch {
        // The run said why.
      } finally {
        running = false;
        next();
        wakeIdle();
      }
    })();
  }

  function fire() {
    clearTimeout(timer);
    if (!waiting) return;
    due = waiting;
    waiting = null;
    next();
  }

  const debounced = (value: T) => {
    waiting = { value };
    clearTimeout(timer);
    timer = setTimeout(fire, ms);
  };
  const settled = () =>
    new Promise<void>((done) => {
      idle.push(done);
      fire();
      wakeIdle();
    });
  return Object.assign(debounced, { flush: fire, settled });
}
