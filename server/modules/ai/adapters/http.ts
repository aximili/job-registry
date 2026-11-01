// What both connectors share about one request over fetch: the address, the
// time limit, and reading a stream of server-sent events.

// How long a model list may take.
export const HEALTH_TIMEOUT_MS = 5000;

export const trimSlash = (url: string): string => url.replace(/\/+$/, '');

// The time limit for one request. restart() gives it the full time again.
export function timeLimit(seconds: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const restart = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new DOMException('The AI took too long.', 'TimeoutError')), seconds * 1000);
  };
  restart();
  return { signal: controller.signal, restart, stop: () => clearTimeout(timer) };
}

// The data of each event in a stream, as text. alive() is called for every
// line that comes, so a server that is still working keeps the time limit
// from running out. Lines that don't start with "data:" are event names,
// comments or keep-alives (OpenRouter's ": OPENROUTER PROCESSING"), and are
// skipped.
export async function* sseData(res: Response, alive: () => void): AsyncIterable<string> {
  if (!res.body) return;
  const decoder = new TextDecoder();
  let pending = '';
  for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      alive();
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}
