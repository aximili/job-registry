import type { HttpModule } from '../../core/http/module.ts';
import { aiRoutes } from './routes.ts';
import { createAiService, type AiOptions, type AiService } from './service.ts';

export type { AiService, BriefInput, CardInput, ClassifyInput, CutBrief, PrepInput, Priority, RateInput, WriteInput } from './service.ts';
export type { AiProvider, ChatRequest, ChatChunk } from './provider.ts';
export type { ModelRuntime } from './runtime.ts';
// Adapters and runtimes, for app.ts to wire. Nothing else imports these.
export { createAnthropicProvider } from './adapters/anthropic.ts';
export { createOpenAiCompatibleProvider } from './adapters/openai-compatible.ts';
export { createCloudRuntime } from './runtime/cloud.ts';
export { createLlamaServerRuntime } from './runtime/llama-server.ts';
export { createNoopRuntime } from './runtime/noop.ts';

export function createAiModule(opts: AiOptions): HttpModule<AiService> {
  const service = createAiService(opts);
  return { service, routes: aiRoutes(service) };
}
