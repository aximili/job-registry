// Pretends to be llama-server, for the runtime tests:
//   node tests/fakes/fake-llama-server.ts --port 8089 [--slow-start-ms 3000] [--exit-after-ms 500] [--smart]
// It waits (if asked), then serves the fake OpenAI-style API on that port.
// With --smart it reads ads a little and rates them, like the browser tests' fake.

import { FAKE_RATING } from './fake-ai-provider.ts';
import { startFakeOpenAiServer, type FakeHandler } from './fake-openai-server.ts';
import { readAdLikeAPerson } from './smart-fake-ai.ts';

function arg(name: string): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : Number(process.argv[i + 1]);
}

const port = arg('port') ?? 8080;
const slowStart = arg('slow-start-ms') ?? 0;
const exitAfter = arg('exit-after-ms');

console.log(`fake llama-server starting on ${port}`);
await new Promise((r) => setTimeout(r, slowStart));
const smart: FakeHandler = (body) => {
  const schema = (body.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema?.name;
  const messages = body.messages as { content: string }[];
  if (schema === 'parsed_job') return { content: JSON.stringify(readAdLikeAPerson(messages[1]!.content.split('The job ad:').pop() ?? '')) };
  if (schema === 'rating') return { content: JSON.stringify(FAKE_RATING) };
  return { content: 'OK' };
};
await startFakeOpenAiServer(process.argv.includes('--smart') ? smart : undefined, { port });
console.log('fake llama-server ready');
if (exitAfter !== undefined) setTimeout(() => process.exit(3), exitAfter);
process.on('SIGTERM', () => process.exit(0));
