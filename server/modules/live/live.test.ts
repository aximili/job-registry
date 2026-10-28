import { afterEach, expect, it } from 'vitest';
import { createTestApp, freePort, type TestApp } from '../../../tests/helpers/test-app.ts';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string, timeoutMs = 2000): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  while (!text.includes(needle)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${needle}; got ${JSON.stringify(text)}`);
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

it('streams bus events to a connected client', async () => {
  const port = await freePort();
  app = await createTestApp({ port });
  await app.http.listen({ host: '127.0.0.1', port });
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/events`, { signal: controller.signal });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  await waitFor(() => app!.services.live.clientCount() === 1);

  app.bus.emit('job.updated', { jobId: 7, fields: ['title'] });
  app.bus.emit('settings.changed', { keys: ['statuses'] });
  const text = await readUntil(reader, 'settings.changed');
  expect(text).toContain('event: job.updated\ndata: {"jobId":7,"fields":["title"]}\n\n');
  expect(text).toContain('event: settings.changed\ndata: {"keys":["statuses"]}\n\n');
  controller.abort();
});

it('drops the client when the connection closes', async () => {
  const port = await freePort();
  app = await createTestApp({ port });
  await app.http.listen({ host: '127.0.0.1', port });
  const controller = new AbortController();
  await fetch(`http://127.0.0.1:${port}/api/v1/events`, { signal: controller.signal });
  await waitFor(() => app!.services.live.clientCount() === 1);
  controller.abort();
  await waitFor(() => app!.services.live.clientCount() === 0);
});
