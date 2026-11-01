// A stand-in for fetch, for the AI connectors' tests. No test ever calls a
// real cloud AI: the connector gets this fetch instead, and each test says
// what the "provider" answers.

export type FetchCall = {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown> | null;
  signal: AbortSignal | null;
};

// Records each request and answers with reply().
export function fakeFetch(reply: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const doFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call: FetchCall = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      signal: init.signal ?? null,
    };
    calls.push(call);
    return reply(call);
  }) as typeof fetch;
  return { doFetch, calls };
}

// A stream sent slowly: each line after its pause. Like a real fetch, it
// stops with the request's abort reason (the time limit, say).
export function slowStream(signal: AbortSignal | null, steps: [pauseMs: number, line: string][]): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      signal?.addEventListener('abort', () => controller.error(signal.reason));
      for (const [pauseMs, line] of steps) {
        await new Promise((r) => setTimeout(r, pauseMs));
        if (signal?.aborted) return;
        controller.enqueue(new TextEncoder().encode(`${line}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}
