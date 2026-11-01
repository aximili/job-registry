# Phase 8: Several AIs, Switched in One Click — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save any number of AIs (local or cloud, each with its own key, model and task settings), switch the one in use from the header in one click, and add one from a list of popular providers.

**Architecture:** `settings.json`'s `ai` section becomes `{ active, saved: SavedAi[] }`, and an old flat file is read as one saved AI. API keys live in `secrets.json` under `aiKeys`, by AI id. A provider catalogue in `shared/contracts/ai-presets.ts` gives each preset its address, key link, suggested models and *dialect*. The dialect says which connector to use and how that provider wants JSON, thinking and the token limit. The OpenAI-style connector learns the dialects and keys, and a new Claude connector speaks Anthropic's Messages API. The AI service builds a provider per AI, so it can test or list models for any AI, switch at once, and check that the right local model answers. Ratings are cached per model.

**Tech Stack:** TypeScript (Node runs `.ts` directly), Fastify, zod 4, Svelte 5, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-31-several-ais-design.md](../specs/2026-10-31-several-ais-design.md). Read it before your task. **Provider facts:** `.superpowers/sdd/2026-10-31-phase-8-several-ais/provider-research.md` (checked 31 Oct 2026). Tasks 2–4 use it.

## Global Constraints

- **No git writes.** Never `git add`, `commit`, `push`, `stash`, `reset`, `checkout`, `restore`. The user commits by hand. Leave edits in the working tree.
- **Bash:** never prefix a command with `PATH=…` or `cd … &&`. Never use `curl` or `wget` (use `node -e "fetch(…)"`).
- Plain English and Australian spelling in UI text, docs, comments, errors and prompts. Short sentences.
- TypeScript: erasable syntax only. No `enum`, no constructor parameter properties.
- Architecture rules (AGENTS.md, architecture.md §4 and §15): other modules import only a module's `index.ts`; SQL only in `repo.ts`; Fastify only in `routes.ts`; every API body is a zod schema in `shared/contracts/`; only `server/app.ts` wires modules; `jobs` never depends on `ai`. `npm run check:deps` must pass. Never weaken a rule.
- **No database change.** AIs live in `settings.json`; keys in `secrets.json`.
- Tests sit next to the code (`*.test.ts`). Fakes live in `tests/fakes/`. No real cloud call in any test.
- **A key never leaves the server** except to its own provider: never in a response body, a log line, an error message, `settings.json`, the extension, or a test copy of the settings. A provider's error text has the key removed before it goes anywhere.
- Settings shape: `ai = { active: string, saved: SavedAi[] }`, at least one saved AI, `active` names one of them, ids unique. `SavedAi` = every field of today's `ai` section plus `id` and `name`. Default: one AI, id `bonsai-2`, name `Bonsai 2`, preset `llama-server`, today's defaults.
- AI ids: lower case `a–z`, `0–9` and single `-` between parts, at most 40 characters, unique, made from the name when the AI is added, never changed afterwards.
- Migrated names for an old flat file: `llama-server` → `Bonsai 2`, `ollama` → `Ollama`, `lmstudio` → `LM Studio`, `custom` → `My AI server`.
- The four existing preset ids (`llama-server`, `ollama`, `lmstudio`, `custom`) keep their names.
- **Exact copy:**
  - Switch toast: `Now using {name}.`
  - Key refused (401, 403): `{name} refused its API key. Check the key in Settings → AI.`
  - Limit (429, 402, or a quota, billing or balance error): `{name} says you've reached a usage limit. Wait a while, or switch to another AI from the AI pill at the top.`
  - No key saved for a preset that needs one: `{name} needs an API key. Add it in Settings → AI.`
  - Busy (503, 529, or an `overloaded` error): `{name} is busy right now. Try again in a minute.`
  - JSON by `json_object` (added to the end of the system message): `Reply in json: one object that matches this JSON Schema:\n{schema}` (it has both "json" and "JSON", which DeepSeek and Qwen require)
  - Suggested-model tags: `Best`, `Recommended`, `Best value`, `Fast`, `Cheapest`, `Free tier`, `Small, for a busy PC`
  - Wrong local model, other AI known: `{other} is still running on {host}. Close its window, then try again.`
  - Wrong local model, other AI unknown: `Another model ({file}) is running on {host}, not {name}'s ({expected}). Close it, then try again.`
  - Same address, model file unknown (at the switch): `{from} may still be running on {host}. Close its window if it is.`
  - Switcher's last item: `Manage AIs…`. Settings → AI: `My AIs`, `Add an AI`, `In use`, `Use this`, `Duplicate`, `Delete`, `Get a key`, `Key saved`, `Replace`, `Remove`, `Test connection`, `Save AI settings`.
  - Duplicate's name: `{name} (copy)`. Delete is disabled for the AI in use (`Switch to another AI first.`) and the last AI (`You need at least one AI.`).
  - Cloud note: `{provider} sees your profile, the ads you save and rate, and (if email is on) your emails. Each request is billed to this key. Quick marks rate every card on a search page, so they use the most.`
  - Claude's extra note: `Use an API key from the Claude Console. A Claude Pro or Max login can't be used here.`
  - Z.ai's extra note: `Use a pay-per-use API key, not your GLM Coding Plan. The Coding Plan only covers coding tools.`
- Full check before you finish a task: `npm test` (typecheck, svelte-check, check:deps, Vitest). Tasks 8 and 9 also run `npm run test:e2e` in the foreground with a 10-minute timeout. If port 4799 is busy, wait; never stop another run.

## Review Focus

1. **The user's real old `settings.json`** (flat, `preset: "llama-server"`, a `.bat` program, edited tasks with `extra` fields) loads as one saved AI with nothing lost. A hand-edited new-shape file with a typo is still refused. Test in Task 1 with a realistic fixture.
2. **A pasted key with spaces or a newline** is trimmed. A provider error that echoes the key back has it removed. The key never appears in `GET /settings`, `GET /settings/secrets`, a log line or an error. Tests in Tasks 1 and 3.
3. **Switching while a draft is being written.** The draft keeps going on the old AI, or ends with its text kept. Waiting tasks run on the new AI. Test in Task 5.
4. **Switching quickly A → B → A** (a double click in the menu). A ends up in use, and only one program start survives; a start in progress is cancelled. Test in Task 5.
5. **Deleting an AI that has a key, then adding one with the same name** (so the same id comes back). The old key must not come back with it. Test in Task 1.

---

### Task 1: Saved AIs in settings, and API keys in secrets

**Files:**
- Modify: `shared/contracts/ai.ts` (`SavedAi`, `AiId`, new `AiSettings`, `DEFAULT_AI_ID`, `activeAi`, `newAiId`, the old-shape preprocess)
- Modify: `shared/contracts/email.ts` (`SecretsStatus`, `UpdateSecretsRequest`), `shared/contracts/settings.ts` (`UseAiRequest`)
- Modify: `server/modules/settings/service.ts`, `routes.ts`, `index.ts`
- Modify: `shared/api-client.ts` (`useAi`)
- Modify every reader of one AI's settings so it gets the AI in use: `server/app.ts`, `server/modules/ai/service.ts`, `server/modules/ai/runtime/llama-server.ts`, `server/modules/ai/runtime/noop.ts`, `server/modules/ai/tasks/*.ts`, `scripts/eval-parse.ts`, `scripts/handover/lib.ts`, `scripts/handover/prereqs.ts`, `scripts/handover/ai-smoke.ts`, `web/src/components/AiSettingsSection.svelte` (edits the AI in use in place, for now), `web/src/components/EmailSettingsSection.svelte` if the secrets type change touches it
- Modify: `config/settings.example.json` (new shape)
- Create: `tests/fixtures/settings/old-flat-settings.json` (a realistic pre-Phase-8 file: `preset: "llama-server"`, `managed.exe: "D:\\aitest\\Bonsai-demo\\start_bonsai.bat"`, edited `tasks.write` and `tasks.card`, an `extra` field)
- Test: `shared/contracts/contracts.test.ts`, `server/modules/settings/service.test.ts`, `server/modules/settings/routes.test.ts`, `tests/settings-example.test.ts`

**Interfaces:**
- Produces (in `shared/contracts/ai.ts`):
  ```ts
  AiId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(40)
  SavedAi = z.strictObject({ id: AiId, name: z.string().trim().min(1).max(60), preset, baseUrl, model, timeoutSec,
                             stopWhenIdle, idleMinutes, managed, tasks })   // the last eight exactly as today's AiSettings fields
  type SavedAi = z.infer<typeof SavedAi>
  AiSettings  // { active: AiId, saved: SavedAi[] } with the rules above; an old flat object or {} is preprocessed into it
  type AiSettings = z.infer<typeof AiSettings>
  const DEFAULT_AI_ID = 'bonsai-2'
  function activeAi(ai: AiSettings): SavedAi
  function newAiId(name: string, taken: readonly string[]): string   // "Claude – wife's" → "claude-wife-s"; "" → "ai"; taken → "-2", "-3"…
  ```
- Produces (contracts): `SecretsStatus = { emailPassword: boolean, aiKeys: string[] }` (ids that have a key). `UpdateSecretsRequest = z.strictObject({ emailPassword: z.string().nullable().optional(), aiKeys: z.record(AiId, z.string().nullable()).optional() })`; null or blank removes, a missing field is left as it is. `UseAiRequest = z.strictObject({ id: AiId })`.
- Produces (`SettingsService`): `aiKey(id: string): string | null` (for `app.ts` only, like `emailPassword()`) and `useAi(id: string): Settings` (throws `ValidationError` for an unknown id; emits `settings.changed` with `keys: ['ai']`).
- Produces (route): `PUT /api/v1/settings/ai/active` with a `UseAiRequest` body, returning `Settings`. Dashboard-only, like the other settings writes. API client: `useAi(id: string): Promise<Settings>`.
- Every module that took `AiSettings` for one AI now takes `SavedAi`. `app.ts`'s `aiConfig` becomes `() => activeAi(settings.service.get().ai)`.

- [ ] **Step 1: Write the failing contract tests** in `shared/contracts/contracts.test.ts`:
  - `Settings.parse({})` → `ai.active === 'bonsai-2'`, one saved AI named `Bonsai 2`, its `tasks.write.thinkingEffort === 'max'` (today's defaults).
  - `old-flat-settings.json` parses to one saved AI, id `bonsai-2`, name `Bonsai 2`, with the same `managed.exe`, `tasks.write`, `tasks.card` and `extra` as the file, deep-equal to the old values.
  - Each old preset gets its migrated name (`ollama` → `Ollama`, `lmstudio` → `LM Studio`, `custom` → `My AI server`).
  - Refused: `active` naming no saved AI; `saved: []`; two AIs with one id; an unknown key inside a saved AI (`{ …, modle: 'x' }`); an id with upper case.
  - `newAiId`: `('Claude – wife's', [])` → `'claude-wife-s'`; `('Claude', ['claude'])` → `'claude-2'`; `('Claude', ['claude', 'claude-2'])` → `'claude-3'`; `('!!!', [])` → `'ai'`; a 100-character name gives an id of at most 40 characters.
  - `activeAi` returns the saved AI that `active` names.
- [ ] **Step 2: Run** `npx vitest run shared/contracts/contracts.test.ts`. Expected: FAIL (`activeAi` and `newAiId` are not exported).
- [ ] **Step 3: Implement the contracts.** A zod `preprocess` turns an object without `saved` (old flat shape, or `{}`/`undefined`) into `{ active, saved: [old fields + id + name] }` before the strict check. Keep `.prefault({})` working in `Settings`. Keep today's comments on each moved field.
- [ ] **Step 4: Run** the contract tests. Expected: PASS.
- [ ] **Step 5: Write the failing settings service tests** in `server/modules/settings/service.test.ts`:
  - `updateSecrets({ aiKeys: { 'claude-mine': '  sk-ant-123\n' } })` stores `sk-ant-123`; `secrets()` → `{ emailPassword: false, aiKeys: ['claude-mine'] }`; `aiKey('claude-mine') === 'sk-ant-123'`.
  - `updateSecrets({ aiKeys: { 'claude-mine': null } })` and `{ 'claude-mine': '  ' }` each remove it. `updateSecrets({ emailPassword: 'abcd efgh' })` leaves `aiKeys` alone, and the other way round.
  - **Review Focus 5:** a key saved for `claude`; `update({ ai })` with `claude` no longer in `saved` → `aiKey('claude') === null` in the secrets file. Then an AI with the same id added again → still `null`.
  - `useAi('claude-mine')` sets `active` and emits `settings.changed` with `keys: ['ai']`. `useAi('nope')` throws `ValidationError` and changes nothing.
  - `get()` (the whole settings object) never contains a key: `JSON.stringify(service.get())` doesn't include `sk-ant-123`.
- [ ] **Step 6: Run** `npx vitest run server/modules/settings`. Expected: FAIL.
- [ ] **Step 7: Implement** `aiKey`, `useAi`, `aiKeys` in `Secrets` (default `{}`), and key clean-up in `update()` (keys whose id isn't saved any more are removed; then emit `keys` with `'secrets'` too). Add the `PUT /settings/ai/active` route with `dashboardOnly('Only the dashboard can change settings.')`, and a route test showing it's refused for an extension origin and works for the dashboard.
- [ ] **Step 8: Move every reader to `SavedAi`** (the file list above) so `npm run typecheck` passes. `AiSettingsSection.svelte` edits `activeAi(app.settings.ai)` and saves it back into its place in `saved`. Its look and behaviour don't change yet (Task 8 rebuilds it). `config/settings.example.json` uses the new shape. The handover's `testSettings` may keep writing the flat shape, which the preprocess reads.
- [ ] **Step 9: Run** `npm test`. Expected: all pass.

### Task 2: The provider catalogue

**Files:**
- Create: `shared/contracts/ai-presets.ts` (exported from `shared/contracts/index.ts`)
- Modify: `shared/contracts/ai.ts` (move `AiPresetId`, `AiPreset` and `AI_PRESETS` out to the new file; `ai.ts` imports them)
- Test: `shared/contracts/ai-presets.test.ts`

**Interfaces:**
- Consumes: `SavedAi`, `newAiId` (Task 1).
- Produces:
  ```ts
  AiPresetId = z.enum(['anthropic', 'openai', 'gemini', 'deepseek', 'kimi', 'zai', 'qwen', 'mistral', 'xai', 'groq', 'openrouter',
                       'llama-server', 'ollama', 'lmstudio', 'custom'])
  type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';
  // The body fields each level adds; null adds nothing. 'llama' is today's mapping, unchanged.
  type ThinkingMap = Record<ThinkingLevel, Record<string, unknown> | null>;
  type AiDialect = {
    connector: 'openai' | 'anthropic';
    json: 'schema' | 'object';          // response_format json_schema, or json_object plus the schema written into the system message
    thinking: 'llama' | ThinkingMap;
    maxTokens: 'max_tokens' | 'max_completion_tokens';
    temperature: boolean;                // false: never send temperature
    listModels: boolean;                 // false: the provider has no model list, so only the suggestions show
  };
  type ModelTag = 'Best' | 'Recommended' | 'Best value' | 'Fast' | 'Cheapest' | 'Free tier' | 'Small, for a busy PC';
  type AiPreset = {
    label: string; group: 'cloud' | 'local'; baseUrl: string | null;
    key: 'required' | 'optional' | 'none'; keyUrl: string | null;
    needsModel: boolean; managed: boolean; dialect: AiDialect;
    note: string | null;                 // shown when you add or edit it (the cloud note, plus Claude's, Z.ai's or Qwen's extra note)
    models: { id: string; tag: ModelTag }[];   // the first is the default for a new AI
  };
  const AI_PRESETS: Record<AiPresetId, AiPreset>
  const PRESETS_CHECKED = '31 Oct 2026'
  function newSavedAi(preset: AiPresetId, name: string, taken: readonly string[]): SavedAi
  ```
  `newSavedAi` takes its id from `newAiId(name, taken)`, its `baseUrl` from the preset (`''` for `custom`), its `model` from the preset's first suggested model (or `''`), and every other field from today's defaults. `managed.enabled` follows `preset.managed`.

- [ ] **Step 1: Write the failing tests** in `shared/contracts/ai-presets.test.ts`:
  - There are 15 presets. Every `cloud` preset has `key: 'required'`, a `keyUrl` starting `https://`, a `baseUrl` starting `https://`, and a `note` that starts with the cloud note. Every `local` preset has `key` `'none'` or `'optional'` (`custom` is optional).
  - The four local presets' dialect is `{ connector: 'openai', json: 'schema', thinking: 'llama', maxTokens: 'max_tokens', temperature: true, listModels: true }`, so Bonsai 2 requests don't change.
  - Each cloud preset's dialect matches the "Controller's dialect table" at the end of the research file, row by row (one `it.each` over the table's values).
  - `anthropic` uses `connector: 'anthropic'`, its first model is `claude-sonnet-5-5` (`Best value`), and its note includes Claude's extra note. `zai`'s `baseUrl` is `https://api.z.ai/api/paas/v4`, never a `/coding/` address, and its note includes Z.ai's extra note. `qwen`'s note includes `If Alibaba Cloud gave you a workspace address, use that instead.`
  - `newSavedAi('anthropic', 'Claude – mine', [])` parses with `SavedAi`, has id `claude-mine`, the preset's address and its first model.
  - The old ids and labels still work: `AI_PRESETS['llama-server'].label === 'Bonsai 2 (llama-server)'`.
- [ ] **Step 2: Run** `npx vitest run shared/contracts/ai-presets.test.ts`. Expected: FAIL.
- [ ] **Step 3: Fill in the catalogue from the research file.** Each dialect comes from the "Controller's dialect table". The addresses, key links and suggested models come from each provider's section. Order the suggestions with the default first: Claude Sonnet 5.5 (`Best value`), Opus 5.5 (`Recommended`), Fable 5.1 (`Best`), Haiku 5.5 (`Cheapest`); for the others, put `Best value` first where there is one, otherwise `Best`. Bonsai 2's suggestions are its 27B file (`Best`) and a smaller file (`Small, for a busy PC`) only if the research or `download-ai.ps1` names one; otherwise just the 27B. Where the research says "unverified", keep the value and add a short comment saying so. Put `PRESETS_CHECKED` and a one-line "how to update" comment at the top. Order the record as listed in `AiPresetId` (cloud first, then local), because the dropdown uses this order.
- [ ] **Step 4: Run** the tests, then `npm test`. Expected: PASS.

### Task 3: The OpenAI-style connector learns keys, dialects and plain errors

**Files:**
- Modify: `server/modules/ai/provider.ts` (`ProviderConfig`)
- Modify: `server/modules/ai/adapters/openai-compatible.ts`
- Create: `server/modules/ai/adapters/http-errors.ts` (shared with Task 4)
- Modify: `server/app.ts` (pass the new config fields)
- Test: `server/modules/ai/adapters/openai-compatible.test.ts`, `server/modules/ai/adapters/http-errors.test.ts`

**Interfaces:**
- Consumes: `AI_PRESETS`, `AiDialect` (Task 2).
- Produces:
  ```ts
  // provider.ts
  type ProviderConfig = { name: string; preset: AiPresetId; baseUrl: string; model: string; timeoutSec: number;
                          apiKey: string | null; dialect: AiDialect };
  // openai-compatible.ts
  createOpenAiCompatibleProvider(getConfig: () => ProviderConfig, opts?: { fetch?: typeof fetch }): AiProvider
  // http-errors.ts
  function redactKey(text: string, key: string | null): string
  function httpError(status: number, bodyText: string, config: ProviderConfig): AiRefusedError   // the exact copy for 401/403 and the limit; otherwise today's sentence, naming the AI
  function needsKeyError(config: ProviderConfig): AiRefusedError | null                          // the "needs an API key" sentence when the preset needs one and apiKey is null
  ```

- [ ] **Step 1: Write the failing tests:**
  - A request with `apiKey: 'sk-1'` sends `authorization: Bearer sk-1` on chat, stream and `GET /models`. With `apiKey: null`, there's no `authorization` header.
  - **Body tests for each cloud preset's dialect** (`it.each` over the presets, using `AI_PRESETS[id].dialect`), each showing the exact body for thinking off, Low and No limit, with `maxTokens: 512`: the map's fields are merged in; the token limit is `512 + THINKING_TOKENS[level]` for low, medium and high, `512` for off, and left out for No limit. The llama body is exactly today's (today's tests must still pass unchanged).
  - `json: 'object'` sends `response_format: { type: 'json_object' }` and adds the exact copy `Reply in json: one object that matches this JSON Schema:\n{schema}` to the end of the system message. `json: 'schema'` is unchanged.
  - `maxTokens: 'max_completion_tokens'` sends that field and no `max_tokens`. `temperature: false` never sends `temperature`. For `zai`, a temperature above 1 is sent as 1.
  - `extra` still wins last, and `null` still removes a field.
  - A preset with `key: 'required'` and `apiKey: null` throws the "needs an API key" sentence **without calling fetch**.
  - A message whose `content` is an array (Mistral) gives the `type: 'text'` parts as `text` and the `type: 'thinking'` parts as `thinking`, both in `chat` and in stream deltas.
  - A stream that has `: OPENROUTER PROCESSING` comment lines still works. A stream chunk with `finish_reason: 'error'` (OpenRouter, HTTP 200) throws the chunk's error message (named, key removed), keeping the text so far as today's cut-off does.
  - `health()` with `listModels: false` returns `{ ok: true, models: [], detail: null }` without calling fetch.
  - Errors, each naming the AI (`config.name`):
    - 401 and 403 → the key-refused sentence. So is a 400 whose body says `api key` or `apikey`, in any case (xAI).
    - 402 and 429 → the limit sentence. So is any 4xx whose body mentions `quota`, `billing`, `balance`, `credit`, `arrearage` or `spend limit`, in any case. This check comes before the key check, so Qwen's `403 AllocationQuota.FreeTierOnly` is a limit.
    - 503, 529, or a body that says `overloaded` → the busy sentence.
  - **Review Focus 2:** a 400 body that contains the key (`{"error":"bad key sk-1"}`) → the thrown message doesn't contain `sk-1`.
- [ ] **Step 2: Run** `npx vitest run server/modules/ai/adapters`. Expected: FAIL.
- [ ] **Step 3: Implement.** Follow each dialect value's mapping from the research file. Every other failure keeps today's sentences, with the AI's name where the address appears now ("The AI at …" → "{name} at …").
- [ ] **Step 4: Run** the tests, then `npm test`. Expected: PASS.

### Task 4: The Claude connector

**Files:**
- Create: `server/modules/ai/adapters/anthropic.ts`, `server/modules/ai/adapters/anthropic.test.ts`
- Modify: `server/modules/ai/index.ts` (export `createAnthropicProvider`)
- Modify: `docs/architecture.md` §4.2 only if you add a dependency

**Interfaces:**
- Consumes: `ProviderConfig`, `httpError`, `needsKeyError`, `redactKey` (Task 3).
- Produces: `createAnthropicProvider(getConfig: () => ProviderConfig, opts?: { fetch?: typeof fetch }): AiProvider`

- [ ] **Step 0:** Load the `claude-api` skill. It's the reference for the Messages API, structured outputs, thinking, prompt caching, streaming events, model listing and error shapes. Use the research file for the provider facts it adds.
- [ ] **Step 1: Write the failing tests** (an injected `fetch`, as `openai-compatible.test.ts` does):
  - `chat` posts to `{baseUrl}/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, `model`, `max_tokens`, the system message as a top-level system block marked `cache_control: { type: 'ephemeral' }`, and the other messages in order. It never sends `temperature`, `top_p` or `top_k` (current models refuse them), and never sends a field outside the Messages API (unknown fields get a 400).
  - `jsonSchema` is sent as `output_config: { format: { type: 'json_schema', schema } }`. Before it's sent, the schema gets `additionalProperties: false` on every object, and loses `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `minItems`, `maxItems` and `pattern` (Anthropic refuses them; zod still checks every answer). The answer's text comes back as `text`.
  - Thinking is `thinking: { type: 'adaptive', display: 'summarized' }` with `output_config.effort`: off and Low → `low`, Medium → `medium`, High → `high`, No limit → `max`. It's never `disabled` and never `budget_tokens` (both get a 400 on current models). `max_tokens` is the task's longest answer plus `THINKING_TOKENS[level]` (off counts as low). For No limit, it's the model's `max_tokens` from `GET /models` (looked up once, then remembered), or `64000` if that isn't known. Thinking blocks come back as `thinking`, never in `text`.
  - `chatStream` turns `text_delta` events into `{ kind: 'text' }` chunks and `thinking_delta` into `{ kind: 'thinking' }`, ignores `signature_delta` and `ping`, and ends at `message_stop` (there's no `[DONE]`). A `max_tokens` stop reason throws today's cut-off sentence after the text so far. An `error` event mid-stream throws its sentence.
  - `health()` lists models from `GET {baseUrl}/models` with the key.
  - No key → the "needs an API key" sentence, without calling fetch. 401 → key refused. 402, 429, or a 400 about a spend limit → the limit sentence. 529 `overloaded_error` → the busy sentence. The key never appears in an error.
  - The time limit works as in the OpenAI-style connector: a plain answer within `timeoutSec`, and a stream that fails only after `timeoutSec` with nothing new.
- [ ] **Step 2: Run** `npx vitest run server/modules/ai/adapters/anthropic.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with plain `fetch`, as the OpenAI-style connector does (or Anthropic's SDK if you find a strong reason; then update architecture.md §4.2 and say why in your report).
- [ ] **Step 4: Run** the tests, then `npm test`. Expected: PASS.

### Task 5: The AI service: a provider per AI, switching, testing any AI, and the model-file check

**Files:**
- Modify: `shared/contracts/ai.ts` (`expectedModelFile`, `sameAddressWarning`, `AiCheckRequest`, `AiModelsResult`, `AiStatus` gains `id` and `name`)
- Modify: `server/modules/ai/service.ts`, `routes.ts`, `index.ts`, `runtime/noop.ts`
- Modify: `server/app.ts` (`providerFor`, `getKey`, `getAll`)
- Modify: `shared/api-client.ts` (`checkAi`, `aiModels`)
- Modify: `tests/helpers/test-app.ts`, `tests/fakes/*` as needed
- Test: `server/modules/ai/ai.test.ts`, `server/modules/ai/switch.test.ts` (new), `shared/contracts/contracts.test.ts`, `server/modules/ai/routes.test.ts` (new, or an existing API test file)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces (`shared/contracts/ai.ts`):
  ```ts
  function expectedModelFile(ai: SavedAi): string | null
    // llama-server only. A program (not .bat): the file name after -m or --model in managed.args.
    // Otherwise ai.model's file name, if set. Lower case, no folder. Every other preset: null.
  function sameAddressWarning(from: SavedAi, to: SavedAi): string | null
    // The "may still be running" sentence when both are llama-server, same origin, different ids,
    // the app doesn't stop `from` itself (a .bat, or managed off), and expectedModelFile(to) is null.
  AiCheckRequest = z.strictObject({ ai: SavedAi, key: z.string().trim().min(1).max(1000).optional() })
  AiModelsResult = z.object({ ok: z.boolean(), models: z.array(z.string()), detail: z.string().nullable() })
  AiStatus  // + id: string, name: string (the AI in use)
  ```
- Produces (`AiOptions`, replacing `provider`):
  ```ts
  providerFor: (ai: SavedAi, key: string | null) => AiProvider;  // app.ts picks the connector from AI_PRESETS[ai.preset].dialect.connector; fakes.ai when set
  getKey: (id: string) => string | null;
  getAll: () => SavedAi[];
  ```
- Produces (`AiService`): `check(req: AiCheckRequest): Promise<AiTestResult>`, `models(req: AiCheckRequest): Promise<AiModelsResult>`, `modelIdentity(task: 'rate' | 'card'): string`.
- Produces (routes, both dashboard-only): `POST /api/v1/ai/check` (`AiCheckRequest` → `AiTestResult`) and `POST /api/v1/ai/models` (`AiCheckRequest` → `AiModelsResult`). `POST /ai/test` stays as it is: it tests the AI in use, as saved. API client: `checkAi(req)`, `aiModels(req)`.

- [ ] **Step 1: Write the failing tests:**
  - `expectedModelFile`: a program with `-m ai/models/Ternary-Bonsai-2-27B-PQ2_0.gguf` → `ternary-bonsai-2-27b-pq2_0.gguf`; a `.bat` with `model: 'D:\\m\\Bonsai-2B.gguf'` → `bonsai-2b.gguf`; a `.bat` with no model → `null`; `ollama` → `null`.
  - `sameAddressWarning`: two llama-server AIs on `127.0.0.1:8080`, `from` a `.bat`, `to` with no model file → the exact sentence; `to` with a model file → `null`; `from` a program the app starts → `null`; different ports → `null`.
  - Each task uses the provider for the AI in use, with its saved key (`providerFor` is called with the active AI and `getKey(id)`).
  - **Switch, start at once:** `settings.changed` with a new `active` that's a managed llama-server → the old runtime's `stop()` is called, then the new runtime's `ensureRunning()` is called without `background`, before any task. A switch to a cloud AI starts nothing.
  - **Review Focus 4:** A → B → A within one tick → `active` is A, the runtime ends up started once for A, and the cancelled start for B rejects with `AbortError` without reaching the error state.
  - **Review Focus 3:** a `writeDocument` stream running when the AI switches → it either finishes on the old provider, or ends with the text so far and today's "stopped" error. A task queued behind it runs on the new provider.
  - **Model-file check:** the AI in use is llama-server with expected file `bonsai-2b.gguf`; the server lists `ai/models/Ternary-Bonsai-2-27B-PQ2_0.gguf`, which a saved AI named `Bonsai 27B` uses → the task fails with `Bonsai 27B is still running on 127.0.0.1:8080. Close its window, then try again.` and the status is `error`. No match among the saved AIs → the "Another model" sentence. Matching file, or no expected file, or an empty model list → the task runs.
  - **A cloud AI has no program to check.** It uses a runtime whose `ensureRunning()` resolves at once without calling the provider (a new `createCloudRuntime()`, or the noop runtime with an option). Its state is `ready` after a good task and `error` (with the sentence) after a failed one, through the service's existing `failure` handling. So a provider with no model list (Z.ai, Qwen) still works.
  - `check()` with an AI that isn't in use calls that AI's provider with the given key (or `getKey(ai.id)` when no key is given), never touches the runtime, and doesn't wait in the queue. `check()` for the AI in use waits in the queue and may start the runtime, as `test()` does today. Neither saves anything. For a cloud AI, the model list is best effort: a failed `health()` doesn't fail the check, and the test chat decides `ok`.
  - `models()` returns the provider's model list; on failure, `{ ok: false, models: [], detail: <sentence> }`.
  - `modelIdentity('rate')`: `anthropic` with `tasks.rate.model: 'claude-haiku-5-5'` → `anthropic|claude-haiku-5-5`; no task model → `anthropic|<ai.model>`; llama-server → `llama-server|<expectedModelFile>`; no model at all → `<preset>|ai:<id>`.
  - Routes: `/ai/check` and `/ai/models` are refused for an extension origin; a key in the request never appears in the response.
- [ ] **Step 2: Run** `npx vitest run server/modules/ai shared/contracts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The service remembers the active id it last saw. On `settings.changed` with `ai`: if the id changed, swap the runtime (today's `useRuntime`), then start the new one at once when it's an app-started local AI (errors go to the status, not thrown). The model-file check runs in `run()` after `ensureRunning`, using the provider's `health()` model list, only for llama-server AIs with an expected file. `status()` adds `id` and `name`. The noop runtime takes whatever it needs to call the active provider's `health()`.
- [ ] **Step 4: Run** the tests, then `npm test`. Expected: PASS.

### Task 6: Ratings per model

**Files:**
- Modify: `server/modules/ratings/service.ts`
- Test: `server/modules/ratings/service.test.ts`

**Interfaces:**
- Consumes: `AiService.modelIdentity(task)` (Task 5).
- Produces: no new names. The cache's `profile_hash` value becomes the profile hash joined with the model identity's hash. The format is yours to choose, as long as it's stable.

- [ ] **Step 1: Write the failing tests:**
  - `rate()` twice with the same identity → the AI is called once. Change the identity (a different model) → the AI is called again. Change it back → cached, no call.
  - The same for `rateCard()`, using `modelIdentity('card')`.
  - `lookupCards()` finds a full rating only under `modelIdentity('rate')` and a quick one only under `modelIdentity('card')`.
  - Two AIs with the same preset and model (different ids, so different keys) share ratings.
- [ ] **Step 2: Run** `npx vitest run server/modules/ratings`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, then `npm test`. Expected: PASS.

### Task 7: Scripts and the handover follow the AI in use

**Files:**
- Modify: `scripts/eval-parse.ts`, `scripts/handover/lib.ts`, `scripts/handover/prereqs.ts`, `scripts/handover/ai-smoke.ts`, any other handover check that reads `settings.ai`
- Modify: `docs/handover/runbook.md` (and `do-by-hand.md` if it mentions Settings → AI's layout)
- Test: `tests/handover.test.ts`, plus a test for eval-parse's option reading if it has one (add one if the option logic is more than a line)

**Interfaces:**
- Consumes: `activeAi`, `AI_PRESETS[...].group` (Tasks 1–2).
- Produces: `npm run eval:parse -- --ai "<name or id>"`. It picks that saved AI for the run (matching the name case-insensitively, or the id), copies only that AI's key into the temporary `secrets.json`, and deletes the copy at the end. An unknown name lists the saved names and exits 1.

- [ ] **Step 1: Write the failing tests:** `appAi` gets the AI in use. When that's a cloud AI, the local AI checks print `SKIP` with `the AI in use is {name}, a cloud AI; these checks are for Bonsai 2`. The test settings that the handover writes never contain an `aiKeys` value. eval-parse's `--ai` picks by name and by id, and an unknown name exits 1 listing the names.
- [ ] **Step 2: Run** `npx vitest run tests/handover.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and update the runbook's steps and expected outputs to match.
- [ ] **Step 4: Run** the tests, then `npm test`. Expected: PASS.

### Task 8: The switcher and Settings → AI, as design options (design-first, stops for the user's pick)

**Files:**
- Create: `web/src/components/AiSwitcher.svelte` (replaces `AiPill.svelte` in `Header.svelte`; delete `AiPill.svelte` once nothing uses it)
- Create: `web/src/lib/ai-list.ts` and `web/src/lib/ai-list.test.ts` (pure helpers)
- Modify: `web/src/components/AiSettingsSection.svelte` (split into smaller components if it helps, for example `AiForm.svelte` and `AiList.svelte`), `web/src/lib/ai-state.svelte.ts` (the name of the AI in use), `web/src/pages/SettingsPage.svelte` if needed
- Modify: `.claude/skills/design-first/shoot.ts`: seed three saved AIs (`Bonsai 2` in use, `Bonsai 2B light`, `Claude – mine` with a key), and add a page `ai-menu` that shoots the header with the switcher open
- Test: `web/src/lib/ai-list.test.ts`

**Interfaces:**
- Consumes: `api.useAi`, `api.checkAi`, `api.aiModels`, `api.updateSecrets({ aiKeys })`, `api.secretsStatus()`, `AI_PRESETS`, `newSavedAi`, `sameAddressWarning`, `activeAi`, `AiStatus.name`.
- Produces (`web/src/lib/ai-list.ts`):
  ```ts
  function duplicateAi(ai: AiSettings, id: string): AiSettings            // adds "{name} (copy)" with a new id, after the original
  function removeAi(ai: AiSettings, id: string): AiSettings               // throws the exact sentence for the AI in use or the last one
  function deleteBlock(ai: AiSettings, id: string): string | null         // why Delete is disabled, or null
  function aiSummary(ai: SavedAi): string                                  // "{preset label} · {model}" ("· no model" when empty)
  function presetGroups(): { label: 'Cloud' | 'On this computer'; ids: AiPresetId[] }[]
  ```

- [ ] **Step 1:** Load the design-first skill (`.claude/skills/design-first/SKILL.md`) and the `frontend-design` skill. Read AGENTS.md's "Always give the best possible UX".
- [ ] **Step 2: Write the failing tests** for `ai-list.ts`. They cover `duplicateAi` (name, new id, position, no key copied: it touches settings only), `removeAi` and `deleteBlock` (the two exact sentences), `aiSummary`, and `presetGroups` (cloud first, in catalogue order). Run `npx vitest run web/src/lib/ai-list.test.ts`. Expected: FAIL. Then implement until they pass.
- [ ] **Step 3: Shoot "before"** (skill step 1), including `--pages settings` and the header.
- [ ] **Step 4: Build the behaviour once, shared by every option.**
  - The switcher: the AI in use and its state, a menu of saved AIs with the one in use marked, `Manage AIs…`. Picking one calls `useAi`, shows `Now using {name}.` plus `sameAddressWarning` when it applies, and keeps the focus on the switcher button. Keyboard: Enter and Space open it, the arrows move, Escape closes and returns the focus. An AI problem shows its sentence at the top of the menu.
  - Settings → AI: the `My AIs` list; `Add an AI` with the grouped provider dropdown; the form (name, address, key with `Get a key`, `Key saved`, `Replace`, `Remove`, the model list fetched with `aiModels` from the typed or saved key plus free typing, suggested models with their tags first, the local program fields as today, the "Model file" field for a llama-server `.bat`, the task rows as today, the preset's note).
  - `Test connection` calls `checkAi` with the form's values and never saves. `Save AI settings` saves the AI section, then the key, if one was typed.
  - The side menu's `AI, Problem` mark stays.
- [ ] **Step 5: Build two or three options** for the switcher's look and for Settings → AI's layout (list and form), using the skill's `DESIGN_OPTION` constant. Make them differ in kind. Shoot each one, in both themes and both widths, including `ai-menu`. Look at every shot.
- [ ] **Step 6: Run** `npm test` and `npm run test:e2e` (foreground, 10-minute timeout) with the default option. Update existing browser tests only where a name they use had to change (the pill link `/^AI /` becomes the switcher button). Expected: all pass.
- [ ] **Step 7: Stop and report.** Report each option's one-line idea, its trade-off, its screenshot paths and your recommendation, then end the task. The controller shows these to the user. Don't remove any option yet.

### Task 9: Build the user's pick, and the browser tests

**Files:**
- Modify: the Task 8 components (remove the options not picked, and the `DESIGN_OPTION` constant)
- Create: `tests/e2e/ai-switch.spec.ts`
- Modify: `tests/e2e/ai.spec.ts`, `tests/e2e/settings.spec.ts` as needed
- Modify: `docs/architecture.md` §10 (the switcher and Settings → AI rules, so the docs match the build)

**Interfaces:**
- Consumes: the user's pick (in the dispatch), the Task 8 components.

- [ ] **Step 1: Remove the options not picked**, leaving no dead branches.
- [ ] **Step 2: Write the browser tests** in `tests/e2e/ai-switch.spec.ts` (Firefox and Chromium, with the fake AI):
  - Add `Claude – mine` from the Claude preset with a key. Test it before saving: the result shows, and nothing is saved yet (it's not in the switcher). Save it: `Key saved` shows, and the key's text isn't in the page.
  - Duplicate it → `Claude – mine (copy)`, which has no key.
  - Switch from the switcher by mouse → `Now using Claude – mine.`, and the switcher shows the name. Switch back by keyboard only (Tab to it, Enter, ArrowDown, Enter) → the focus is back on the switcher button.
  - Test an AI that isn't in use → a result, and the AI in use doesn't change.
  - `Remove` the key → `Key saved` goes away. Delete is disabled for the AI in use, with its sentence.
- [ ] **Step 3: Run** `npm run test:e2e` (foreground, 10-minute timeout). Expected: PASS. Run `npm test`. Expected: PASS.
- [ ] **Step 4: Shoot "after"** and compare it with "before" in both themes and widths (skill step 4). Report both sets of paths.

### Task 10: Docs

**Files:**
- Modify: `docs/architecture.md` (§1, §4.1, §5, §6.1, §6.2, §7.6 if the states changed, §9, §12, §13, §16, §17; §4.2 if Task 4 added a dependency)
- Create: `docs/decisions/0011-several-ais-and-cloud-providers.md`
- Modify: `docs/decisions/0004-openai-compatible-ai.md` (a line pointing to 0011: not every server supports `json_schema` now)
- Modify: `README.md` (the AI section: saved AIs, switching, keys, the presets, privacy and cost, why a Claude or Coding Plan subscription can't be used, `eval:parse -- --ai`)
- Modify: `AGENTS.md` (Current status: a Phase 8 entry, in the style of the others), `docs/plan.md` (status line, and Phase 8 in the phase list)

- [ ] **Step 1:** Update each file so it matches the code as built, with the spec as the guide. 0011 follows 0004's format (Status, Context, Decision, Other options considered, Consequences).
- [ ] **Step 2: Run** `npm test` (the source-text and settings-example tests read docs and config). Expected: PASS.
