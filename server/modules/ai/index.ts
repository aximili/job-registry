import type { HttpModule } from '../../core/http/module.ts';
import { aiRoutes } from './routes.ts';
import { createAiService, type AiOptions, type AiService } from './service.ts';

export type { AiService, Priority, RateInput } from './service.ts';
export type { AiProvider, ChatRequest, ChatChunk } from './provider.ts';
export type { ModelRuntime } from './runtime.ts';
// Adapters and runtimes, for app.ts to wire. Nothing else imports these.
export { createOpenAiCompatibleProvider } from './adapters/openai-compatible.ts';
export { createLlamaServerRuntime } from './runtime/llama-server.ts';
export { createNoopRuntime } from './runtime/noop.ts';

export function createAiModule(opts: AiOptions): HttpModule<AiService> {
  const service = createAiService(opts);
  return { service, routes: aiRoutes(service) };
}
