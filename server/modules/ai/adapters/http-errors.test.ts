import { describe, expect, it } from 'vitest';
import { AI_PRESETS, type AiPresetId } from '../../../../shared/contracts/index.ts';
import { AiAccountError, AiRefusedError, AiUnavailableError } from '../../../core/errors.ts';
import type { ProviderConfig } from '../provider.ts';
import { httpError, needsKeyError, redactKey } from './http-errors.ts';

const config = (preset: AiPresetId = 'openai', over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  name: 'OpenAI – mine',
  preset,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-6.1-sol',
  timeoutSec: 300,
  apiKey: 'sk-1',
  dialect: AI_PRESETS[preset].dialect,
  ...over,
});

const KEY_REFUSED = 'OpenAI – mine refused its API key. Check the key in Settings → AI.';
const LIMIT = "OpenAI – mine says you've reached a usage limit. Wait a while, or switch to another AI from the AI pill at the top.";
const BUSY = 'OpenAI – mine is busy right now. Try again in a minute.';

const errorBody = (message: string, extra: Record<string, unknown> = {}) => JSON.stringify({ error: { message, ...extra } });

describe('redactKey', () => {
  it('removes every copy of the key', () => {
    expect(redactKey('bad key sk-1, and again: sk-1.', 'sk-1')).toBe('bad key [key hidden], and again: [key hidden].');
  });

  it('leaves the text alone when there is no key', () => {
    expect(redactKey('bad key sk-1', null)).toBe('bad key sk-1');
    expect(redactKey('bad key sk-1', '')).toBe('bad key sk-1');
  });
});

describe('httpError', () => {
  // A problem with the AI as a whole (its key, its limit, it being busy) is
  // an AiAccountError: every request fails the same way until it's fixed, so
  // waiting work keeps waiting. Only a request refused for itself is an
  // AiRefusedError, which marks that one job or email.
  it.each([
    ['a refused key (401)', 401, errorBody('Incorrect API key provided.')],
    ['a refused key (403)', 403, errorBody('Forbidden.')],
    ['a refused key (400 about an API key)', 400, errorBody('API key not valid.')],
    ['a usage limit (429)', 429, errorBody('Too many requests')],
    ['a usage limit (402)', 402, errorBody('Payment required')],
    ['a usage limit (400 about billing)', 400, errorBody('Check your billing details.')],
    ['busy (503)', 503, ''],
    ['busy (529)', 529, ''],
    ['busy (an overloaded error)', 429, errorBody('The engine is overloaded.', { type: 'engine_overloaded_error' })],
  ])('%s is an AiAccountError, not an AiRefusedError', (_what, status, body) => {
    const err = httpError(status, body, config());
    expect(err).toBeInstanceOf(AiAccountError);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err).not.toBeInstanceOf(AiRefusedError);
  });

  it('any other error, and a moderation refusal, is an AiRefusedError: about this one request', () => {
    for (const err of [
      httpError(400, errorBody('Bad model name.'), config()),
      httpError(500, errorBody('Internal error'), config()),
      httpError(403, errorBody('Your input was flagged by moderation.'), config()),
    ]) {
      expect(err).toBeInstanceOf(AiRefusedError);
      expect(err).not.toBeInstanceOf(AiAccountError);
    }
  });

  it.each([401, 403])('a %i says the AI refused its key, naming the AI', (status) => {
    expect(httpError(status, errorBody('Incorrect API key provided.'), config()).message).toBe(KEY_REFUSED);
  });

  it.each(['Incorrect API key provided: xai-****', 'Invalid APIKEY', 'apikey missing', 'API_KEY_INVALID'])(
    'a 400 that says "%s" is a refused key too (xAI and Gemini answer a wrong key with 400)',
    (message) => {
      expect(httpError(400, errorBody(message), config()).message).toBe(KEY_REFUSED);
    },
  );

  it.each([402, 429])('a %i is a usage limit', (status) => {
    expect(httpError(status, errorBody('Too many requests'), config()).message).toBe(LIMIT);
  });

  it.each([
    [400, errorBody('Overdue payment', { code: 'Arrearage' })],
    [400, errorBody('You have reached your spend limit.')],
    // Anthropic, when a limit you set in the Claude Console is reached.
    [400, JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your specified API usage limits.' } })],
    [403, errorBody('The free tier quota is used up.', { code: 'AllocationQuota.FreeTierOnly' })],
    [422, errorBody('Insufficient Balance')],
    [401, errorBody('Your credit balance is too low.')],
    [400, errorBody('Check your BILLING details.')],
    [403, 'QUOTA exceeded'],
  ])('a %i about quota, billing, balance, credit, arrearage, a spend limit or usage limits is a usage limit, before the key check', (status, body) => {
    expect(httpError(status, body, config()).message).toBe(LIMIT);
  });

  it("only the error's own message, code and type count, not the input a provider echoes back", () => {
    // OpenRouter's moderation refusal quotes the flagged part of the prompt: a job ad.
    const moderation = JSON.stringify({
      error: {
        code: 403,
        message: 'Your chosen model requires moderation and your input was flagged.',
        metadata: { reasons: ['harassment'], flagged_input: 'Credit analyst: balance sheets, billing, overloaded team…', provider_name: 'OpenAI' },
      },
    });
    expect(httpError(403, moderation, config()).message).not.toBe(LIMIT);
    expect(httpError(403, moderation, config()).message).not.toBe(BUSY);
    const echo = JSON.stringify({ error: { message: 'Bad request.', metadata: { flagged_input: 'Rotate the API key monthly' } } });
    expect(httpError(400, echo, config()).message).toBe('OpenAI – mine at https://api.openai.com/v1 answered with an error (400): Bad request.');
  });

  it("a 403 moderation refusal is not a refused key: it quotes the provider's own message", () => {
    const moderation = JSON.stringify({
      error: {
        code: 403,
        message: 'Your chosen model requires moderation and your input was flagged.',
        metadata: { reasons: ['harassment'], flagged_input: 'Credit analyst: balance sheets…', provider_name: 'OpenAI' },
      },
    });
    const message = httpError(403, moderation, config()).message;
    expect(message).not.toBe(KEY_REFUSED);
    expect(message).not.toBe(LIMIT);
    expect(message).toBe(
      'OpenAI – mine at https://api.openai.com/v1 answered with an error (403): Your chosen model requires moderation and your input was flagged.',
    );
    // Any case, in the code or type too, and the key never shows.
    expect(httpError(403, JSON.stringify({ error: { message: 'Blocked.', type: 'MODERATION_ERROR' } }), config()).message).toBe(
      'OpenAI – mine at https://api.openai.com/v1 answered with an error (403): Blocked.',
    );
    expect(httpError(403, JSON.stringify({ error: { message: 'FLAGGED input from sk-1' } }), config()).message).toBe(
      'OpenAI – mine at https://api.openai.com/v1 answered with an error (403): FLAGGED input from [key hidden]',
    );
    // Only the error's own fields count: a word in its metadata doesn't.
    expect(httpError(403, JSON.stringify({ error: { message: 'Forbidden.', metadata: { reasons: ['moderation'] } } }), config()).message).toBe(
      KEY_REFUSED,
    );
  });

  it.each([
    ['error.type', JSON.stringify({ error: { message: 'Request refused.', type: 'insufficient_quota' } })],
    ['error.code', JSON.stringify({ error: { message: 'Request refused.', code: 'credit_balance_exhausted' } })],
    ['top-level code', JSON.stringify({ code: 'Arrearage', message: 'Overdue.', request_id: 'r1' })],
    ['top-level type', JSON.stringify({ type: 'billing_error', message: 'Refused.' })],
  ])('a limit word in %s still counts', (_where, body) => {
    expect(httpError(400, body, config()).message).toBe(LIMIT);
  });

  it("unwraps Gemini's one-item list", () => {
    const wrapped = (message: string) => JSON.stringify([{ error: { code: 400, message, status: 'INVALID_ARGUMENT' } }]);
    expect(httpError(400, wrapped('Bad model name.'), config()).message).toBe(
      'OpenAI – mine at https://api.openai.com/v1 answered with an error (400): Bad model name.',
    );
    expect(httpError(400, wrapped('API key not valid. Please pass a valid API key.'), config()).message).toBe(KEY_REFUSED);
  });

  it('a quota word outside a 4xx is not a usage limit', () => {
    expect(httpError(500, errorBody('quota service down'), config()).message).toBe(
      'OpenAI – mine at https://api.openai.com/v1 answered with an error (500): quota service down',
    );
  });

  it.each([
    [503, errorBody('Service unavailable')],
    [529, JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })],
    [500, errorBody('The engine is OVERLOADED.')],
    // Kimi's 429 when its servers are full: busy, not your limit.
    [429, errorBody('The engine is currently overloaded, please try again later', { type: 'engine_overloaded_error' })],
  ])('a %i (or a body that says overloaded) means the AI is busy', (status, body) => {
    expect(httpError(status, body, config()).message).toBe(BUSY);
  });

  it("any other error gives today's sentence, with the AI's name and address and its own message", () => {
    expect(httpError(500, errorBody('reasoning_effort "high" is not supported'), config()).message).toBe(
      'OpenAI – mine at https://api.openai.com/v1 answered with an error (500): reasoning_effort "high" is not supported',
    );
    expect(httpError(404, JSON.stringify({ error: 'model not found' }), config()).message).toBe(
      'OpenAI – mine at https://api.openai.com/v1 answered with an error (404): model not found',
    );
    expect(httpError(422, JSON.stringify({ object: 'error', message: 'Bad temperature' }), config()).message).toBe(
      'OpenAI – mine at https://api.openai.com/v1 answered with an error (422): Bad temperature',
    );
    expect(httpError(500, 'plain text trouble', config()).message).toBe(
      'OpenAI – mine at https://api.openai.com/v1 answered with an error (500): plain text trouble',
    );
  });

  it('an empty body falls back to the status name', () => {
    expect(httpError(404, '', config()).message).toBe('OpenAI – mine at https://api.openai.com/v1 answered with an error (404): Not Found');
  });

  it('a long message is cut to 300 characters', () => {
    const message = httpError(500, errorBody('x'.repeat(1000)), config()).message;
    expect(message.endsWith(`: ${'x'.repeat(300)}`)).toBe(true);
  });

  it('a body that echoes the key never shows it (Review Focus 2)', () => {
    const message = httpError(400, '{"error":"bad key sk-1"}', config()).message;
    expect(message).not.toContain('sk-1');
    expect(message).toBe('OpenAI – mine at https://api.openai.com/v1 answered with an error (400): bad key [key hidden]');
    expect(httpError(500, 'sk-1 sk-1', config()).message).not.toContain('sk-1');
  });

  it('a key echoed in an escaped form is hidden too, once the JSON is read', () => {
    // JSON may write "/" as "\/", and any letter as "\u0061" and the like.
    const key = 'sk-ab/cd';
    const slash = httpError(400, '{"error":{"message":"bad key sk-ab\\/cd"}}', config('openai', { apiKey: key })).message;
    expect(slash).toBe('OpenAI – mine at https://api.openai.com/v1 answered with an error (400): bad key [key hidden]');
    const unicode = httpError(400, '{"error":{"message":"bad key \\u0073k-ab\\u002Fcd"}}', config('openai', { apiKey: key })).message;
    expect(unicode).not.toContain(key);
    expect(unicode).toContain('[key hidden]');
  });
});

describe('needsKeyError', () => {
  it('names the AI when its preset needs a key and none is saved', () => {
    const err = needsKeyError(config('openai', { apiKey: null }));
    expect(err).toBeInstanceOf(AiAccountError);
    expect(err).not.toBeInstanceOf(AiRefusedError);
    expect(err?.message).toBe('OpenAI – mine needs an API key. Add it in Settings → AI.');
    expect(needsKeyError(config('deepseek', { apiKey: '' }))?.message).toBe('OpenAI – mine needs an API key. Add it in Settings → AI.');
  });

  it('is null when a key is saved, or the preset needs none', () => {
    expect(needsKeyError(config('openai'))).toBeNull();
    expect(needsKeyError(config('custom', { apiKey: null }))).toBeNull();
    expect(needsKeyError(config('llama-server', { apiKey: null }))).toBeNull();
  });
});
