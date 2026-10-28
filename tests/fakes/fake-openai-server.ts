// A small stand-in for an OpenAI-style AI server (llama-server, Ollama,
// LM Studio). It listens on 127.0.0.1 and answers /health, /v1/models and
// /v1/chat/completions, as JSON or as a stream. Tests choose each reply.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeReply = {
  content?: string;
  reasoning?: string; // sent as reasoning_content, like llama-server
  reasoningField?: 'reasoning_content' | 'reasoning';
  status?: number;
  error?: string;
  delayMs?: number;
  // Why the answer ended: 'length' when max_tokens cut it off.
  finishReason?: 'stop' | 'length';
};

export type FakeOpenAiServer = {
  url: string; // http://127.0.0.1:PORT/v1
  origin: string;
  requests: Record<string, unknown>[];
  close(): Promise<void>;
};

export type FakeHandler = (body: Record<string, unknown>) => FakeReply;

const defaultHandler: FakeHandler = () => ({ content: 'OK' });

export async function startFakeOpenAiServer(
  handler: FakeHandler = defaultHandler,
  opts: { port?: number; models?: string[] } = {},
): Promise<FakeOpenAiServer> {
  const requests: Record<string, unknown>[] = [];

  const server = createServer((req, res) => {
    void route(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    if (req.method === 'GET' && url === '/health') return json(res, 200, { status: 'ok' });
    if (req.method === 'GET' && url === '/v1/models') {
      return json(res, 200, { object: 'list', data: (opts.models ?? ['fake-model']).map((id) => ({ id, object: 'model' })) });
    }
    if (req.method === 'POST' && url === '/v1/chat/completions') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      requests.push(body);
      const reply = handler(body);
      if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      if (res.destroyed) return;
      if (reply.status && reply.status >= 400) {
        return json(res, reply.status, { error: { message: reply.error ?? 'Something broke', type: 'server_error' } });
      }
      const field = reply.reasoningField ?? 'reasoning_content';
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (delta: Record<string, unknown>) =>
          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
        if (reply.reasoning) send({ [field]: reply.reasoning });
        for (const piece of chunks(reply.content ?? '')) send({ content: piece });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reply.finishReason ?? 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const message: Record<string, unknown> = { role: 'assistant', content: reply.content ?? '' };
      if (reply.reasoning) message[field] = reply.reasoning;
      return json(res, 200, { id: 'x', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: 'stop' }] });
    }
    json(res, 404, { error: { message: 'Not found' } });
  }

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    url: `${origin}/v1`,
    origin,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function chunks(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 7) out.push(text.slice(i, i + 7));
  return out;
}
