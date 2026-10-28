# 0004 — Talk to the AI through the OpenAI-style chat API

**Status:** Accepted (28 Oct 2026)

## Context
The default model is Bonsai 2 (PrismML). For now it runs only on PrismML's own build of llama.cpp, so Ollama and LM Studio can't load it. You also want to be able to switch to Ollama or other models.

## Decision
The `ai` module speaks the OpenAI-style `/v1/chat/completions` API through one `AiProvider` adapter. llama-server, Ollama, LM Studio and vLLM all offer this API. A separate, optional `ModelRuntime` adapter starts and stops llama-server for you, and stops it when idle to free GPU memory.

## Other options considered
- **Ollama's own API only.** Simple, but can't run Bonsai 2 today.
- **Embedding llama.cpp in Node (node-llama-cpp).** No separate process, but it ties the app to one runtime build. Bonsai 2's custom formats need PrismML's fork anyway.

## Consequences
- Changing the model or the server is a settings change.
- Small differences between servers, like how thinking is switched off, are handled inside the adapter.
- Structured output uses `response_format: json_schema`, which all the target servers support.
