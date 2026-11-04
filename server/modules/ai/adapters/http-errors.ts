// Plain sentences for an AI's errors, shared by the adapters. Each one names
// the AI, and none ever shows its API key: a provider's error text has the
// key taken out before it's read, and the sentence once more after.
//
// A problem with the AI as a whole (no key, a refused key, a usage limit,
// busy) is an AiAccountError, so waiting work keeps waiting. Anything else
// is an AiRefusedError: about this one request.

import { STATUS_CODES } from 'node:http';
import { AI_PRESETS } from '../../../../shared/contracts/index.ts';
import { AiAccountError, AiRefusedError, AiUnavailableError } from '../../../core/errors.ts';
import { cantReachSentence, USE_ANOTHER_AI, type ProviderConfig } from '../provider.ts';

// Words in a 4xx body that mean you're out of credit or over a limit. Each
// provider uses its own status for this (402, 429, 400, even 403), so the
// words count first: OpenAI's insufficient_quota, DeepSeek's balance, Qwen's
// Arrearage and AllocationQuota, Anthropic's credit balance, spend limit and
// "API usage limits" (a limit you set in the Claude Console).
const LIMIT_WORDS = /quota|billing|balance|credit|arrearage|spend limit|usage limit/i;

// xAI and Gemini answer a wrong key with 400, not 401.
const KEY_WORDS = /api[ _-]?key/i;

// A 403 that blocks the prompt, not the key.
const MODERATION_WORDS = /moderation|flagged/i;

// The text with every copy of the key taken out.
export function redactKey(text: string, key: string | null): string {
  return key ? text.replaceAll(key, '[key hidden]') : text;
}

// The sentence for an HTTP error from the AI. The words are looked for only
// in the error's own message, code and type, never in the rest of the body:
// OpenRouter's moderation refusal quotes the flagged prompt, and a job ad
// can easily say "credit" or "billing".
export function httpError(status: number, bodyText: string, config: ProviderConfig): AiAccountError | AiRefusedError {
  const body = redactKey(bodyText, config.apiKey);
  const own = readBody(body);
  const { name } = config;
  const clientError = status >= 400 && status < 500;
  if (clientError && LIMIT_WORDS.test(own.words)) return new AiAccountError(limitSentence(name));
  // Before 429: Kimi says its servers are full with a 429 "engine_overloaded_error".
  if (status === 503 || status === 529 || /overloaded/i.test(own.words)) {
    return new AiAccountError(`${name} is busy right now. Try again in a minute.`);
  }
  if (status === 402 || status === 429) return new AiAccountError(limitSentence(name));
  // OpenRouter blocks a flagged prompt with a 403. That isn't the key, so it
  // falls through to the provider's own words.
  const moderation = status === 403 && MODERATION_WORDS.test(own.words);
  if (!moderation && (status === 401 || status === 403 || (status === 400 && KEY_WORDS.test(own.words)))) {
    return new AiAccountError(`${name} refused its API key. Check the key in Settings → AI.`);
  }
  // The JSON may have written the key another way ("\/" for "/", or
  // "\u0061" for "a"), so it's only plain once read: hide it again.
  const message = redactKey((own.message ?? body).trim(), config.apiKey) || STATUS_CODES[status] || 'no details';
  return new AiRefusedError(redactKey(`${name} at ${config.baseUrl} answered with an error (${status}): ${message.slice(0, 300)}`, config.apiKey));
}

// The sentence for an error the AI sends after HTTP 200, inside a stream or
// a whole answer (OpenRouter does this). The error is text, or has a message.
export function streamError(error: unknown, config: ProviderConfig): AiRefusedError {
  const message = redactKey(readError({ error }).message ?? 'no details', config.apiKey);
  return new AiRefusedError(`${config.name} at ${config.baseUrl} stopped with an error: ${message.slice(0, 300)}`);
}

// The sentence for an AI whose preset needs a key, when none is saved.
export function needsKeyError(config: ProviderConfig): AiAccountError | null {
  if (AI_PRESETS[config.preset].key !== 'required' || config.apiKey) return null;
  return new AiAccountError(`${config.name} needs an API key. Add it in Settings → AI.`);
}

// The answer ran out of room. On this computer, the server's context may be
// full too. A cloud AI's context is large, and it isn't yours to change.
const CUT_OFF =
  "The AI ran out of room before it finished. In Settings → AI, give this task less thinking or a longer answer, then try again. If that doesn't help, the AI server's context is full: give it a bigger one (llama-server's -c).";

export const cutOffSentence = (config: ProviderConfig): string =>
  AI_PRESETS[config.preset].group === 'cloud'
    ? `${config.name} ran out of room before it finished. In Settings → AI, give this task less thinking or a longer answer, then try again.`
    : CUT_OFF;

// A request that failed before it had an answer. A cancel stays a cancel.
// Everything else becomes a sentence that says what went wrong, with which
// AI, and where.
export function requestError(err: unknown, config: ProviderConfig, stream: boolean): Error {
  if (err instanceof AiUnavailableError) return err;
  const errName = (err as Error)?.name;
  if (errName === 'AbortError') return err as Error;
  if (errName === 'TimeoutError') {
    return new AiRefusedError(
      stream
        ? `${config.name} at ${config.baseUrl} sent nothing for ${config.timeoutSec} seconds.`
        : `${config.name} at ${config.baseUrl} didn't answer within ${config.timeoutSec} seconds.`,
    );
  }
  return new AiUnavailableError(cantReachSentence(config));
}

const limitSentence = (name: string): string =>
  `${name} says you've reached a usage limit. Wait a while, or ${USE_ANOTHER_AI}.`;

// The error in a body. When the body isn't JSON, the text is all there is.
function readBody(body: string): ProviderError {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { message: null, words: body };
  }
  return readError(data);
}

// The provider's own message, and the words to look in (its message, code and
// type), in the shapes they use: { error: "…" }, { error: { message, code,
// type } }, or a top-level { message, code, type } (Mistral, Qwen, Claude).
// Gemini's OpenAI-style address can wrap the whole thing in a one-item list.
type ProviderError = { message: string | null; words: string };
type ErrorShape = { error?: unknown; message?: unknown; code?: unknown; type?: unknown };

function readError(data: unknown): ProviderError {
  const one = Array.isArray(data) && data.length === 1 ? (data[0] as unknown) : data;
  if (!one || typeof one !== 'object') return { message: null, words: '' };
  const top = one as ErrorShape;
  const inner: ErrorShape = top.error && typeof top.error === 'object' ? (top.error as ErrorShape) : {};
  const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const message = text(top.error) ?? text(inner.message) ?? text(top.message);
  const label = (v: unknown): string | null => (typeof v === 'number' ? String(v) : text(v));
  const words = [message, label(inner.code), label(inner.type), label(top.code), label(top.type)].filter(Boolean).join(' ');
  return { message, words };
}
