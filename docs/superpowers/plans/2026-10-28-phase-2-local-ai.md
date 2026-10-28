# Phase 2 — Local AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app talks to a local AI. A saved ad is read in the background and fills in the job's empty fields, and saved jobs get a match rating against your master profile. The AI server is chosen in Settings (Bonsai 2 through a llama-server the app starts and stops, Ollama, LM Studio or a custom URL), with a "Test connection" button. Saving never waits for the AI.

**Architecture:** Five modules join the server. `ai` (foundation) owns the AI port, the OpenAI-style adapter, the llama-server runtime, a one-at-a-time priority queue and two tasks (`parseJob`, `rateJob`), with prompts as text files. `profile` (foundation) reads `profile/*.md`. `ratings` (composite: `ai`, `profile`) rates an ad and caches the answer in a new `rating_cache` table. `enrich` (composite: `jobs`, `ai`, `ratings`) listens for `posting.added`, parses, applies the result through `jobs.applyParsed`, then rates. The dashboard gets an AI pill, the parse state and rating on the call sheet, an AI section in Settings, and an Edit dialog that sends only what you touched.

**Tech stack:** as Phase 1. No new runtime dependencies: `fetch`, `node:child_process` and zod 4's `z.toJSONSchema()` cover it.

**Spec:** [docs/plan.md](../../plan.md) (Phase 2, "AI module design") and [docs/architecture.md](../../architecture.md) §4–§9, §12, §14. CLAUDE.md "Notes for Phase 2" adds: the start-up sweep of `pending` jobs, the Edit dialog fixes, and the group B minors.

## Global Constraints

- Everything in the Phase 1 plan's Global Constraints still holds: erasable TypeScript, `.ts` import extensions, `/api/v1`, zod contracts in `shared/contracts/`, the error shape, plain English and Australian spelling, `TZ=Australia/Sydney` in tests, no git writes.
- **`npm run check:deps` passes after every task.** Never weaken a rule. The only rule change allowed here is *widening* `adapters-only-from-index` to also cover `ai/runtime/`.
- **Migrations:** add `002_rating_cache.sql` only, with a test. Never edit `001_init.sql`.
- **Never touch the real `data/jobs.db` or `config/settings.json`** in tests or tools. Tests use `createTestApp()` (temporary folder, in-memory database). `npm run eval:parse` copies the real settings file into a temporary config folder.
- **Saving never waits for the AI.** No `await` on AI work inside a save, a route that saves, or an event listener.
- **Thinking switch (verified on 28 Oct 2026 against Bonsai 2's KNOWN_ISSUES.md and Ollama's OpenAI-style API):** `thinking: false` is sent as `reasoning_effort: "none"`. `thinking: true` sends the task's `thinkingEffort` (`"medium"` by default; Bonsai 2 returns HTTP 500 for `"high"`). Not `chat_template_kwargs`: Bonsai's template ignores it.
- **One system message, first.** Bonsai 2's template returns HTTP 500 otherwise. Every request is `[system, user]`, with a retry adding `[assistant, user]`.
- **Ad text sent to the AI** is cut at 12,000 characters, with `\n[The rest of the ad was cut.]` added. The saved ad is never cut.
- **Fakes live in `tests/fakes/`:** `fake-ai-provider.ts`, `fake-runtime.ts`, `fake-openai-server.ts`, `fake-llama-server.ts`.
- **Pinned AI downloads** (from the PrismML release `prism-b10777-e3de715`, the one Bonsai-demo pins):
  - `llama-prism-b10777-e3de715-bin-win-cuda-12.4-x64.zip` and `cudart-llama-bin-win-cuda-12.4-x64.zip`. Use CUDA 12.4: the 13.3 Windows build exits silently on some systems (Bonsai KNOWN_ISSUES #222).
  - Model `Ternary-Bonsai-2-27B-PQ2_0.gguf` (7,206,168,928 bytes) from `prism-ml/Ternary-Bonsai-2-27B-gguf`. Use PQ2_0, not PTQ1_0: PTQ1_0 decodes slowly on CUDA for now.

## Review Focus

1. **The AI isn't running, or the address is wrong** (Ollama closed, LM Studio's server off, llama-server not installed). Saving stays instant. The job shows "Couldn't read the ad" with a plain reason that names the address, and **Parse again** works once the AI is back. → Tasks 3, 6, 9, 11
2. **The model's answer isn't clean JSON**: wrapped in ```` ```json ```` fences, preceded by `<think>…</think>`, cut short, or valid JSON that breaks the schema. The fences and the thinking are stripped. A bad answer gets one retry with the error, then a clear failure. A failure never applies half a result. → Tasks 3, 6
3. **You edit while the AI reads the ad.** Your value wins. The AI's update arriving must not close the Edit dialog or lose your typing, and saving sends only the fields you touched. → Tasks 8, 12
4. **The app stops while llama-server is starting or running** (`stop.bat`, the window closed, a crash). No llama-server is left holding GPU memory. A llama-server you started yourself is never stopped by the app. → Task 4
5. **Many jobs waiting at start-up** (the first start after upgrading: every Phase 1 job with ad text is `pending`). They're read one at a time at background priority. A job you save meanwhile jumps ahead of them, and saving stays instant. → Tasks 5, 9

---

## File map

```
shared/contracts/  ai.ts (AiSettings, presets, AiStatus, AiTestResult), rating.ts (Rating, RateRequest/Response, RatingsStatus)
                   settings.ts (+ ai section), jobs.ts (+ Job.match), index.ts
server/core/db/migrations/002_rating_cache.sql
server/core/events.ts             (+ ai.stateChanged, enrich.done, enrich.failed)
server/modules/ai/                index.ts, service.ts, routes.ts, provider.ts (port + types), queue.ts,
                                  prompts.ts, json.ts (schema + reply clean-up),
                                  adapters/openai-compatible.ts,
                                  runtime/runtime.ts (port), runtime/llama-server.ts, runtime/noop.ts,
                                  tasks/parse-job.ts, tasks/rate-job.ts, tasks/json-task.ts,
                                  prompts/parse-job.md, prompts/rate-job.md
server/modules/profile/           index.ts, service.ts
server/modules/ratings/           index.ts, service.ts, repo.ts, routes.ts
server/modules/enrich/            index.ts, service.ts, routes.ts
server/modules/jobs/              service.ts, repo.ts (+ applyParsed, setParseState, setRating, listIdsByParseState)
server/modules/capture/jsonld.ts  (closing date fix)
server/modules/live/index.ts      (forward ai.* and enrich.*)
server/app.ts, server/main.ts
tests/fakes/                      fake-ai-provider.ts, fake-runtime.ts, fake-openai-server.ts, fake-llama-server.ts
tests/e2e/serve.ts                (fake AI, /__test/ai)
web/src/lib/                      errors.ts, edit-job.ts, ai-state.svelte.ts
web/src/components/               AiPill.svelte, ParseState.svelte, MatchPanel.svelte, Header, CallSheet, EditJobDialog
web/src/pages/                    JobPage, SettingsPage (AI section), App.svelte
scripts/                          eval-parse.ts, eval-score.ts, download-ai.ps1, setup.ps1
download-ai.bat
tests/fixtures/ads/               README.md, 01-seek-example.txt/.expected.json, 02-…, 03-…
tests/eval-score.test.ts
config/settings.example.json, README.md, docs/architecture.md, docs/plan.md, CLAUDE.md
docs/checklists/phase-2-windows.md
```

---

### Task 1: Contracts — AI settings, presets, rating, status

**Files:**
- Create: `shared/contracts/ai.ts`, `shared/contracts/rating.ts`
- Modify: `shared/contracts/settings.ts`, `shared/contracts/jobs.ts`, `shared/contracts/index.ts`, `config/settings.example.json`, `server/core/events.ts`
- Test: `shared/contracts/contracts.test.ts`, `tests/settings-example.test.ts`

**Interfaces (Produces):**
- `AiPresetId = z.enum(['llama-server', 'ollama', 'lmstudio', 'custom'])`
- `AI_PRESETS: Record<AiPresetId, { label: string; baseUrl: string | null; managed: boolean; needsModel: boolean }>`:
  - `llama-server`: "Bonsai 2 (llama-server, started by the app)", `http://127.0.0.1:8080/v1`, managed, no model needed
  - `ollama`: "Ollama", `http://127.0.0.1:11434/v1`, not managed, needs a model
  - `lmstudio`: "LM Studio", `http://127.0.0.1:1234/v1`, not managed, needs a model
  - `custom`: "Another OpenAI-style server", `null`, not managed, needs a model
- `TaskSettings`, built by `taskSettings(defaults)` so each task has its own defaults. Each field is defaulted: `model: string | null` (null = use `ai.model`), `temperature`, `maxTokens`, `thinking: boolean`, `thinkingEffort: 'low' | 'medium' | 'xhigh'` (default `'medium'`), `extra: Record<string, unknown>` (default `{}`; merged last into the request body; a `null` value removes that key).
- `AiSettings` (strict, every field defaulted):
  - `preset` `'llama-server'`, `baseUrl` `'http://127.0.0.1:8080/v1'`, `model` `''`
  - `timeoutSec` 300 (min 5), `idleMinutes` 15 (min 1)
  - `managed: { enabled: true, exe: 'ai/llama.cpp/llama-server.exe', args: ['-m', 'ai/models/Ternary-Bonsai-2-27B-PQ2_0.gguf', '-ngl', '99', '-fa', 'on', '-c', '32768', '--jinja', '--port', '8080'], startTimeoutSec: 120 }`
  - `tasks: { parse: { temperature: 0.2, maxTokens: 4096, thinking: false }, rate: { temperature: 0.3, maxTokens: 2048, thinking: false } }`
- `Settings` gains `ai: AiSettings.prefault({})`. `UpdateSettingsRequest` gains `ai: AiSettings.optional()`.
- `Rating = z.object({ verdict: z.enum(['strong','good','stretch','weak']), score: z.number().int().min(0).max(100), why: z.array(z.string()).max(4), whyNot: z.array(z.string()).max(4), dealBreakers: z.array(z.string()), salaryNote: z.string().nullable() })`
- `Job` gains `match: Rating.nullable()`.
- `AiState = z.enum(['off','starting','ready','busy','error'])`; `AiStatus = { state, detail: string | null, preset: AiPresetId, baseUrl: string }`
- `AiTestResult = { ok: boolean; detail: string; models: string[]; replyMs: number | null }`
- `RateRequest = { capture: Capture; key?: string }`; `RateResponse = { rating: Rating | null; cached: boolean; reason: string | null }`; `RatingsStatus = { ready: boolean; detail: string }`
- Events: `'ai.stateChanged': { state: AiState; detail: string | null }`, `'enrich.done': { jobId: number; step: 'parse' | 'rate' }`, `'enrich.failed': { jobId: number; step: 'parse' | 'rate'; error: string }`
- API client methods: `aiStatus()`, `testAi()`, `rate(req)`, `ratingsStatus()`, `reparseJob(id)`.

- [ ] **Step 1: Write the failing tests** in `contracts.test.ts`:

```ts
it('an empty settings file gets the AI defaults')        // DEFAULT_SETTINGS.ai.preset === 'llama-server', tasks.parse.thinking === false, managed.args contains '-ngl'
it('a partial ai section keeps the other defaults')      // Settings.parse({ ai: { preset: 'ollama', model: 'qwen3:8b' } }).ai.tasks.rate.maxTokens === 2048
it('a misspelt ai key is refused')                       // { ai: { modle: 'x' } } fails
it('a rating has at most four reasons each way')         // 5 entries in why → fails
```
In `tests/settings-example.test.ts`: the example file parses and equals `DEFAULT_SETTINGS` (existing test, which now fails until the example gains `ai`).

- [ ] **Step 2: Run `npx vitest run shared tests/settings-example.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement** the contracts, the event map entries, the api-client methods and the `ai` block in `config/settings.example.json` (written out in full, so it's easy to edit by hand).
- [ ] **Step 4: Run `npm test`.** Expected: PASS. (`Job.match` makes `rowToJob` fail until Task 8 adds `match_json`; add `match: parseJsonColumn(row.match_json)` to `rowToJob` now, so the suite stays green.)

---

### Task 2: Migration 002 — the rating cache

**Files:**
- Create: `server/core/db/migrations/002_rating_cache.sql`
- Test: `server/core/db/db.test.ts`

The table is keyed by `ad_key`, not `canonical_url` as architecture.md §8 shows. Pasted ads have no link, so their key is `text:` plus a SHA-256 of the ad text. Task 14 updates §8.

```sql
CREATE TABLE rating_cache (
  ad_key TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  rating_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (ad_key, profile_hash)
);
```

- [ ] **Step 1: Write the failing test** `it('upgrades a version 1 database with data to version 2 and keeps the data')`: migrate a temporary file using only `001` (a folder holding a copy of `001_init.sql`), insert a job, then `openDb` on the real folder; expect `user_version` 2, the job still there, and the `rating_cache` table present. Also `it('the upgrade backs up first')`: `onBeforeMigrate` is called once.
- [ ] **Step 2: Run `npx vitest run server/core/db`.** Expected: FAIL.
- [ ] **Step 3: Add the migration file.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 3: The AI port, the OpenAI-style adapter and its fakes

**Files:**
- Create: `server/modules/ai/provider.ts`, `server/modules/ai/json.ts`, `server/modules/ai/adapters/openai-compatible.ts`, `tests/fakes/fake-openai-server.ts`, `tests/fakes/fake-ai-provider.ts`
- Test: `server/modules/ai/adapters/openai-compatible.test.ts`, `server/modules/ai/json.test.ts`

**Interfaces (Produces):**
- `provider.ts` (the port, architecture §6.1):
  `type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }`
  `type ChatRequest = { messages: ChatMessage[]; model?: string; temperature?: number; maxTokens?: number; jsonSchema?: { name: string; schema: object }; thinking?: boolean; thinkingEffort?: 'low' | 'medium' | 'xhigh'; extra?: Record<string, unknown> }`
  `type ChatResult = { text: string; thinking: string }`, `type ChatChunk = { kind: 'text' | 'thinking'; text: string }`
  `interface AiProvider { chat(req, opts?: { signal?: AbortSignal }): Promise<ChatResult>; chatStream(req, opts?): AsyncIterable<ChatChunk>; health(): Promise<{ ok: boolean; models: string[]; detail: string | null }> }`
- `createOpenAiCompatibleProvider(getConfig: () => { baseUrl: string; model: string; timeoutSec: number }, opts?: { fetch?: typeof fetch }): AiProvider`
- `json.ts`: `toAiSchema(schema: z.ZodType): object` (zod's `z.toJSONSchema`, then removes `$schema` and every `pattern`, keeps `format`); `extractJson(text: string): unknown` (strips `<think>…</think>` and code fences, then parses the first `{`…last `}`; throws `SyntaxError` with a short message).
- `FakeAiProvider` (`tests/fakes/fake-ai-provider.ts`): `new FakeAiProvider(reply: (req: ChatRequest) => string | Error | Promise<string | Error>, opts?: { delayMs?: number })`; records `calls: ChatRequest[]`; honours `signal` (rejects with an `AbortError` while waiting); `health` returns `{ ok: true, models: ['fake-model'], detail: null }` unless `down = true`.
- `startFakeOpenAiServer(handler?: (body) => FakeReply): Promise<{ url: string; requests: unknown[]; close(): Promise<void> }>`, serving `GET /health`, `GET /v1/models` and `POST /v1/chat/completions` (JSON, or SSE when `stream: true`). `FakeReply = { content?: string; reasoning?: string; status?: number; delayMs?: number }`.

Request body rules for the adapter:
- `model`: `req.model || config.model || 'default'` (llama-server ignores the name, but Ollama and LM Studio need one).
- `temperature`, and `max_tokens` from `maxTokens`.
- `response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }` when `jsonSchema` is set.
- `reasoning_effort`: `'none'` when `thinking === false`, `thinkingEffort ?? 'medium'` when `true`, left out when undefined.
- `extra` merged last; a `null` value deletes the key.

Reply rules: `text` is `message.content` with any `<think>…</think>` removed. `thinking` is `message.reasoning_content` (llama-server), else `message.reasoning` (Ollama), plus any removed `<think>` text. The stream yields the same split, from `delta.reasoning_content`, `delta.reasoning` and `delta.content`.

Errors (all `AiUnavailableError`, with plain messages):
- Connection refused or DNS failure: "Can't reach the AI at {baseUrl}. Check that it's running, or pick another AI in Settings."
- Timeout: "The AI at {baseUrl} didn't answer within {timeoutSec} seconds."
- HTTP error: "The AI server answered with an error ({status}): {first 300 characters of its message}."
- Abort: rethrow the `AbortError` unchanged.

- [ ] **Step 1: Write the failing tests** (against `startFakeOpenAiServer`):

```ts
it('sends one system message first, the model, max_tokens and the JSON schema')
it('turns thinking off with reasoning_effort "none", and on with the task effort')
it('extra fields are sent as they are, and a null removes a field')  // extra: { reasoning_effort: null } → no reasoning_effort key
it('keeps thinking out of the text: reasoning_content, reasoning and <think> blocks') // all three → text has none of it
it('streams text and thinking chunks separately')
it('health lists the server\'s models')
it('a server that is not running gives a plain "Can\'t reach the AI at …" error')  // closed port
it('a slow server times out with the address and the time limit')                // timeoutSec 1, delayMs 1500
it('an HTTP 500 shows the server\'s own message')
it('cancelling aborts the request')
```
In `json.test.ts`: `extractJson` handles fences, a leading `<think>` block, surrounding prose, and throws on `{"a":` (cut short). `toAiSchema(ParsedJob)` has no `pattern` key anywhere and no `$schema`.

- [ ] **Step 2: Run `npx vitest run server/modules/ai`.** Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the port, `json.ts`, the adapter (timeouts with `AbortSignal.any([signal, AbortSignal.timeout(ms)])`) and both fakes.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 4: Runtimes — llama-server managed by the app, or a server you run

**Files:**
- Create: `server/modules/ai/runtime/runtime.ts`, `server/modules/ai/runtime/llama-server.ts`, `server/modules/ai/runtime/noop.ts`, `tests/fakes/fake-runtime.ts`, `tests/fakes/fake-llama-server.ts`
- Modify: `.dependency-cruiser.cjs` (`adapters-only-from-index` covers `(adapters|runtime)/`), `tests/architecture/deps.test.ts`
- Test: `server/modules/ai/runtime/llama-server.test.ts`, `server/modules/ai/runtime/noop.test.ts`

**Interfaces (Produces):**
- `type RuntimeState = 'off' | 'starting' | 'ready' | 'error'`
- `interface ModelRuntime { ensureRunning(signal?: AbortSignal): Promise<void>; touch(): void; stop(): Promise<void>; state(): RuntimeState; detail(): string | null; onStateChange(fn: (state: RuntimeState) => void): () => void }`. Architecture §6.2 gains `detail` and `onStateChange`; `busy` is the AI service's state, not the runtime's.
- `createLlamaServerRuntime(opts: { root: string; logFile: string; getConfig: () => AiSettings; spawn?: typeof spawn; fetch?: typeof fetch; platform?: NodeJS.Platform; kill?: (pid: number) => Promise<void>; now?: Clock }): ModelRuntime`
- `createNoopRuntime(provider: AiProvider, getConfig: () => AiSettings): ModelRuntime`
- `FakeRuntime`: `state` settable, `ensureRunning` resolves (or rejects when `failWith` is set), counts `touches` and `stops`.
- `tests/fakes/fake-llama-server.ts`: a script run as `node tests/fakes/fake-llama-server.ts --port N [--slow-start-ms M]` that serves `startFakeOpenAiServer` on that port after the delay.

Llama-server behaviour (architecture §12.4):
- The health URL is the origin of `baseUrl` plus `/health`.
- `ensureRunning`:
  - Clears the idle timer.
  - If the health URL already answers 200, uses that server and marks it **not owned**: `stop` and the idle timer never touch it.
  - If the exe doesn't exist, fails with "The AI program isn't installed: {exe} is missing. Run download-ai.bat, or pick another AI in Settings."
  - Otherwise spawns `exe` (resolved against `root`) with `args`, `cwd: root`, `windowsHide: true`, and stdout and stderr appended to `logFile`. Then polls health every 500 ms, up to `startTimeoutSec`.
  - A second call while starting waits for the same start.
  - If the process exits during start-up, fails with "llama-server stopped while starting (exit code {n}). See data\logs\llama.log." If the time runs out, kills the process and fails with "llama-server didn't answer at {healthUrl} within {n} seconds. See data\logs\llama.log."
- `touch()` restarts the idle timer (`idleMinutes`). When the timer fires on an owned process, it calls `stop()`.
- `stop()`:
  - On `win32`, runs `taskkill /PID {pid} /T /F`.
  - Elsewhere, sends `SIGTERM`, then `SIGKILL` after 5 seconds.
  - Resolves when the process has exited. The state becomes `off`.
- An owned process that exits on its own sets `error`, with the detail "llama-server stopped unexpectedly (exit code {n}). See data\logs\llama.log." The next `ensureRunning` starts it again.

Noop runtime: `ensureRunning` calls `provider.health()`. If that fails, it raises the provider's `AiUnavailableError`. On success the state becomes `ready`. `stop` does nothing.

- [ ] **Step 1: Write the failing tests** (real child processes running `process.execPath` with the fake script; `exe` = `process.execPath`, `args` = the script path plus `--port`):

```ts
it('starts the process, waits for /health and reports ready')
it('two callers during start-up share one start')                 // spawn called once
it('uses a server that is already running, and never stops it')   // pre-started fake; stop() leaves it answering
it('stops after the idle time')                                   // idleMinutes via a 0.001 override in getConfig (min is enforced by the schema, not the runtime)
it('stop ends the process, and the port stops answering')
it('a process that dies is reported as an error and started again next time')
it('a slow start past the limit is killed, with a message naming the log')   // --slow-start-ms 5000, startTimeoutSec 1
it('a missing program says how to install it')
it('on Windows it stops the whole process tree with taskkill')    // platform 'win32', fake kill records the pid
it('the noop runtime checks the server and passes on a plain error')
```
In `deps.test.ts`: `it('flags module code importing a runtime directly')`.

- [ ] **Step 2: Run `npx vitest run server/modules/ai/runtime tests/architecture`.** Expected: FAIL.
- [ ] **Step 3: Implement** both runtimes, the fakes and the rule change.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 5: The AI queue

**Files:**
- Create: `server/modules/ai/queue.ts`
- Test: `server/modules/ai/queue.test.ts`

**Interfaces (Produces):**
- `type Priority = 'interactive' | 'parse' | 'background'`
- `createAiQueue(): { run<T>(task: { priority: Priority; key?: string; signal?: AbortSignal; work: (signal: AbortSignal) => Promise<T> }): Promise<T>; pending(): number; running(): boolean; onIdle(): Promise<void> }`

Rules (architecture §12.3):
- One task at a time.
- Waiting tasks start in priority order (`interactive` first, then `parse`, then `background`), and in arrival order within a priority. A running task is never interrupted.
- A new task with the same `key` cancels the older one, whether it's waiting or running.
- An aborted `signal` removes a waiting task, or aborts the running task's own signal.
- A cancelled task rejects with a `DOMException` named `AbortError`, with the message "The AI task was cancelled."

- [ ] **Step 1: Write the failing tests:**

```ts
it('runs one task at a time')
it('an interactive task jumps ahead of waiting parse and background tasks, but doesn\'t stop the running one')
it('parse goes before background')            // Review Focus 5
it('a new task with the same key cancels the older one, waiting or running')
it('aborting removes a waiting task, and aborts a running one')
it('a failing task doesn\'t stop the next one')
```
- [ ] **Step 2: Run `npx vitest run server/modules/ai/queue.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it again.** Expected: PASS.

---

### Task 6: AI tasks, prompts, the AI service and its routes

**Files:**
- Create: `server/modules/ai/prompts.ts`, `server/modules/ai/tasks/json-task.ts`, `server/modules/ai/tasks/parse-job.ts`, `server/modules/ai/tasks/rate-job.ts`, `server/modules/ai/prompts/parse-job.md`, `server/modules/ai/prompts/rate-job.md`, `server/modules/ai/service.ts`, `server/modules/ai/routes.ts`, `server/modules/ai/index.ts`
- Modify: `server/app.ts` (wiring, plus the `fakes` argument), `tests/helpers/test-app.ts` (`fakes` option, default `FakeAiProvider` + `FakeRuntime`), `server/modules/live/index.ts` (forward `ai.` and `enrich.`)
- Test: `server/modules/ai/prompts.test.ts`, `server/modules/ai/tasks/tasks.test.ts`, `server/modules/ai/ai.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces:
  - `loadPrompt(dir: string, name: string): { system: string; user: string }`. A file is the system text, a line `=== user ===`, then the user template.
  - `fillPrompt(template: string, values: Record<string, string>): string`. It throws `Error("Prompt placeholder {{x}} has no value")` for a missing value.
  - `interface AiService {`
    - `parseJob(adText: string, opts?: { signal?: AbortSignal; priority?: Priority }): Promise<ParsedJob>;`
    - `rateJob(input: { profile: string; preferences: string | null; ad: string }, opts?: { signal?: AbortSignal; key?: string; priority?: Priority }): Promise<Rating>;`
    - `status(): AiStatus; test(): Promise<AiTestResult>; stop(): Promise<void>; onIdle(): Promise<void> }`
  - `createAiModule(opts: { provider: AiProvider; runtime: () => ModelRuntime; getConfig: () => AiSettings; bus: EventBus; logger: Logger; now: Clock; promptsDir?: string }): HttpModule<AiService>`
  - `index.ts` also exports `createOpenAiCompatibleProvider`, `createLlamaServerRuntime` and `createNoopRuntime` for `app.ts`.
  - Routes: `GET /ai/status` → `AiStatus`; `POST /ai/test` → `AiTestResult`.
  - `buildApp(opts: AppOptions, fakes: Partial<{ ai: AiProvider; runtime: ModelRuntime }> = {})`. In `app.ts`, `runtime` returns the fake if given. Otherwise it returns the llama-server runtime when `preset === 'llama-server' && managed.enabled`, and the noop runtime otherwise. Both are built once.

The JSON task (`runJsonTask<T>(opts: { provider, schema: z.ZodType<T>, schemaName: string, prompt: { system, user }, task: TaskSettings, model: string, signal })`):
1. Sends `[system, user]` with `jsonSchema: { name: schemaName, schema: toAiSchema(schema) }` and the task's settings.
2. Runs `extractJson` on the text, then `schema.safeParse`.
3. On failure, retries once with `[system, user, { role: 'assistant', content: text }, { role: 'user', content: 'That answer was not valid: {error, first 500 characters}. Reply again with only the JSON object.' }]`.
4. A second failure throws `AiUnavailableError("The AI's answer didn't fit the expected format, even after a second try.")`.

`parseJob`:
- Prompt values: `today` (the local date, so "closes in two weeks" works) and `ad` (trimmed to 12,000 characters).
- Schema name `parsed_job`.
- After parsing: `summary` is trimmed, and a blank title, company, agency or location becomes `null`.

`rateJob`: prompt values `profile`, `preferences` (or "None given.") and `ad`. Schema name `rating`. The profile comes first in the prompt, so llama-server can reuse its cache.

The service's state:
- It starts as the runtime's state, and is `busy` while a task runs.
- It emits `ai.stateChanged` only when `{ state, detail }` changes.
- Before each task, it calls `runtime().ensureRunning(signal)`. If the chosen runtime has changed since the last task (because settings changed), it stops the old one first.
- After each task it calls `touch()`.
- A failed `ensureRunning` sets `error` with that message, and the task fails with the same error.

`test()`:
1. `ensureRunning`, then `health()`.
2. If the preset needs a model and `model` is blank, the result is `ok: false` with "Pick a model. The server has: {models, comma-separated}."
3. Otherwise it sends a chat "Reply with the word OK." (`maxTokens` 16, `thinking: false`) and times the reply.
4. Success gives `ok: true` with "Connected to {preset label}. It replied in {n} ms." Any failure gives `ok: false` with the error message. `test()` never throws.

Prompt content (exact rules; wording yours, in plain English):
- **parse-job.md:**
  - Read only what the ad says. Use null (or "unknown", or []) for anything not stated.
  - Salary as numbers per period, with the currency only if shown. AUD for `$` on an Australian ad.
  - `closingDate` as YYYY-MM-DD, worked out from {{today}} if relative.
  - When a recruitment agency posts the ad and hides the employer, put the agency in `agency` and leave `company` null.
  - `summary`: one or two sentences.
  - `requirements`: the must-haves; `niceToHave`; `responsibilities`. Short items, at most 12 each.
  - `adContact`: only if the ad names a contact person.
- **rate-job.md:** rate the fit between the profile and the ad.
  - `verdict` is strong, good, stretch or weak, with a `score` from 0 to 100.
  - Up to four reasons for and four against, each under 20 words and grounded in the profile.
  - `dealBreakers` lists any of the preferences' deal-breakers that the ad hits.
  - `salaryNote` compares the ad's salary with the preferences' salary floor, or is null.
  - Never invent experience.

- [ ] **Step 1: Write the failing tests** (`createTestApp` gains `fakes`; the default fake replies with a valid `ParsedJob` or `Rating` by `jsonSchema.name`):

```ts
// prompts.test.ts
it('every prompt file has a system part and a user part, and every placeholder is filled')
// tasks.test.ts (FakeAiProvider)
it('parseJob sends the ad last, trimmed to 12,000 characters, with thinking off')
it('a reply in code fences after a <think> block still parses')          // Review Focus 2
it('an invalid reply is retried once with the error, then succeeds')
it('two invalid replies fail with a plain message, and nothing is half-applied') // provider called twice
it('rateJob puts the profile before the ad')
// ai.test.ts
it('GET /ai/status starts "off", and a task moves it through busy to ready, sending ai.stateChanged')
it('a runtime that can\'t start sets the state to error, with the reason')
it('POST /ai/test reports the reply time, and asks for a model when one is needed')
it('switching presets stops the old runtime')
it('live events forward ai.stateChanged to the dashboard')
```
- [ ] **Step 2: Run `npx vitest run server/modules/ai`.** Expected: FAIL.
- [ ] **Step 3: Implement**, including the `app.ts` wiring and `close()` calling `ai.stop()` before `db.close()`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 7: Profile and ratings modules

**Files:**
- Create: `server/modules/profile/{index,service}.ts`, `server/modules/ratings/{index,service,repo,routes}.ts`
- Modify: `server/app.ts`
- Test: `server/modules/profile/profile.test.ts`, `server/modules/ratings/ratings.test.ts`

**Interfaces (Produces):**
- `interface ProfileService { read(name: 'master-profile' | 'preferences'): string | null; hash(): string }`
  - `read` gives the file `profile/{name}.md` with any BOM removed, or `null` when the file is missing or only whitespace.
  - `hash` is the first 16 hex characters of the SHA-256 of `master + '\n---\n' + (preferences ?? '')`.
- `createProfileModule(opts: { dir: string }): HttpModule<ProfileService>`, with no routes yet (Phase 4 adds the editors).
- `adKey(ad: { canonicalUrl: string | null; jdText: string }): string` gives the `canonicalUrl` if there is one, else `'text:' + sha256(jdText)`. It's exported from `ratings/index.ts`.
- `interface RatingsService {`
  - `rate(ad: { canonicalUrl: string | null; jdText: string }, opts?: { signal?: AbortSignal; key?: string; priority?: Priority; force?: boolean }): Promise<{ rating: Rating | null; cached: boolean; reason: string | null }>;`
  - `status(): RatingsStatus }`
- Routes: `POST /ratings` (`RateRequest` → `RateResponse`; the request's own close aborts its rating) and `GET /ratings/status`.

Rules:
- With no master profile, `rate` returns `{ rating: null, cached: false, reason: 'Add your master profile as profile/master-profile.md to get match ratings.' }` without calling the AI.
- Otherwise it looks in the cache by `(adKey, hash)`. On a miss it calls `ai.rateJob` and stores the answer.
- `force` skips the cache read, but still stores.
- `status().ready` is true when the master profile exists. The detail says "Ratings use profile/master-profile.md." or gives the reason above.

- [ ] **Step 1: Write the failing tests:**

```ts
it('read returns null for a missing or blank file, and drops a byte-order mark')
it('the hash changes when either file changes')
it('rates once, then answers from the cache for the same ad and profile')   // FakeAiProvider called once
it('a changed profile means a fresh rating')
it('pasted ads are cached by their text')
it('with no master profile it says how to add one and never calls the AI')
it('POST /ratings returns the rating and whether it came from the cache')
it('closing the request cancels a rating that is still waiting')
```
- [ ] **Step 2: Run `npx vitest run server/modules/profile server/modules/ratings`.** Expected: FAIL.
- [ ] **Step 3: Implement and wire** (`createRatingsModule({ db, ai, profile })`).
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 8: Jobs — apply what the AI read, parse state, rating; ad-data fixes (M1, M2)

**Files:**
- Modify: `server/modules/jobs/service.ts`, `server/modules/jobs/repo.ts`, `server/modules/capture/jsonld.ts`
- Test: `server/modules/jobs/service.test.ts`, `server/modules/capture/jsonld.test.ts`

**Interfaces (Produces, added to `JobsService`):**
- `applyParsed(jobId: number, parsed: ParsedJob): Job`
- `setParseState(jobId: number, state: 'pending' | 'failed', error?: string): Job`
- `setRating(jobId: number, rating: Rating): Job` (writes `match_verdict`, `match_score` and `match_json`)
- `listIdsByParseState(state: ParseState): number[]` (unarchived jobs only, oldest first)

`applyParsed` rules (architecture §7.1, "never overwrite your data"). For each of `title, company, agency, location, workMode, employmentType, salary, closingDate, summary, requirements, niceToHave, responsibilities`:
1. If the field's source is `user`, skip it.
2. If the new value is empty, skip it. Empty means `null`, `''`, `[]`, `'unknown'`, or a salary whose `min`, `max` and `text` are all null. An empty answer never clears a value.
3. If the source is `ad` and the current value isn't empty, skip it. The ad's own data beats the AI.
4. If the value is unchanged, skip it.
5. Otherwise set the value, and mark the field's source `ai`.

Also:
- `adContact` is set only when it's null now.
- `parseState` becomes `done`, and `parseError` becomes null.
- It emits `job.updated` with the changed fields plus `parseState`.

M1 and M2 fixes:
- **M1:** when building a job from a capture, structured values that are `null` or blank are dropped before merging, so they can't hide the capture's own title, company or location. In `checkRequestFor`, a blank typed value falls through to the ad's value.
- **M2:** `validThrough` → `closingDate`.
  - With an explicit offset (`+11:00`, `-05:00`), use the date as written: the first 10 characters.
  - With `Z`, use the local date of that moment (`localDate(new Date(v))`).
  - A plain date stays as it is.

- [ ] **Step 1: Write the failing tests:**

```ts
it('applyParsed fills empty fields and marks them as from the AI')
it('applyParsed never changes a field you typed, even one you cleared')   // Review Focus 3
it('the ad\'s own data beats the AI, but the AI fills what the ad left empty')
it('an empty AI answer never clears a value, and a new AI value replaces an older AI value')
it('applyParsed sets parseState done and sends job.updated with what changed')
it('setParseState failed keeps the reason; setRating stores the whole rating on the job')
it('listIdsByParseState lists unarchived pending jobs, oldest first')
it('a null in the ad\'s structured data doesn\'t hide its own title')     // M1
it('a blank typed company falls back to the ad\'s company when checking for duplicates') // M1
// jsonld.test.ts
it('validThrough with an offset keeps the date as written')               // '2026-11-30T00:00:00+11:00' → '2026-11-30'
it('validThrough in UTC uses the local Sydney date')                      // '2026-11-30T14:00:00Z' → '2026-12-01'
```
- [ ] **Step 2: Run `npx vitest run server/modules/jobs server/modules/capture`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 9: Enrich — read new ads, rate them, Parse again, the start-up sweep

**Files:**
- Create: `server/modules/enrich/{index,service,routes}.ts`
- Modify: `server/app.ts`, `server/main.ts`
- Test: `server/modules/enrich/enrich.test.ts`

**Interfaces (Produces):**
- `interface EnrichService { reparse(jobId: number): Job; sweep(): number; onIdle(): Promise<void> }`
- `createEnrichModule(opts: { bus: EventBus; jobs: JobsService; ai: AiService; ratings: RatingsService; logger: Logger }): HttpModule<EnrichService>`
- Route: `POST /jobs/:id/reparse` → `Job` (202). This module owns it, because `jobs` never knows about the AI.
- `App` gains `startBackgroundWork(): void`. `main.ts` calls it after `listen`. It runs `enrich.sweep()` and logs the count.

Flow (architecture §7.1):
- On `posting.added { jobId, postingId }`, start the work without awaiting it:
  1. Find the posting with `jobs.listPostings(jobId)`. Skip it if it has no text.
  2. `setParseState(jobId, 'pending')`.
  3. `ai.parseJob(text, { priority: 'parse' })`, then `jobs.applyParsed`, then emit `enrich.done { step: 'parse' }`.
  4. `ratings.rate(posting, { priority: 'parse' })`. With a rating, call `jobs.setRating` and emit `enrich.done { step: 'rate' }`.
- A failed parse calls `setParseState(jobId, 'failed', err.message)` and emits `enrich.failed { step: 'parse', error }`.
- A failed rating only logs, and emits `enrich.failed { step: 'rate' }`. The parse result stays.
- `reparse(jobId)` uses the newest posting with text, through the same flow at `parse` priority, with `force: true` for the rating. A job with no ad text gives `ValidationError("This job has no ad text to read.")`.
- `sweep()` queues every `pending` job at `background` priority and returns how many.
- `onIdle()` resolves when nothing it started is still running. Tests use it.

- [ ] **Step 1: Write the failing tests** (`createTestApp` with a profile file written into `app.root/profile/master-profile.md` where a rating is wanted):

```ts
it('saving returns at once, and the AI fills in the job afterwards')   // a 300 ms fake AI; save < 50 ms; after onIdle: title from AI, parseState done
it('the job is rated after it is read, when there is a master profile')
it('when the AI can\'t be reached, the job says why and keeps its ad')  // Review Focus 1: parseState failed, parseError contains "Can't reach the AI"
it('Parse again reads the ad again and rates it afresh')
it('Parse again on a job with no ad text says so')
it('a failed rating keeps what was read')
it('the start-up sweep reads waiting jobs at background priority, and a new save goes first') // Review Focus 5
it('a linked second ad is read too, and fills only what is still empty')
```
- [ ] **Step 2: Run `npx vitest run server/modules/enrich`.** Expected: FAIL.
- [ ] **Step 3: Implement and wire.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 10: Checkpoint review 1 (server, Tasks 1–9)

- [ ] **Step 1:** Run `npm test`. Expected: PASS.
- [ ] **Step 2:** Dispatch a fresh Opus reviewer over the Phase 2 server changes. Give it the spec sections, this plan's Global Constraints and Review Focus, and the ledger. Ask for critical, important and minor findings with file and line.
- [ ] **Step 3:** Fix every critical and important finding, each with a test that fails first. Record each in the ledger.

---

### Task 11: Dashboard — AI pill, reading state, Parse again, match rating

**Files:**
- Create: `web/src/lib/ai-state.svelte.ts`, `web/src/components/AiPill.svelte`, `web/src/components/ParseState.svelte`, `web/src/components/MatchPanel.svelte`
- Modify: `web/src/components/Header.svelte`, `web/src/components/CallSheet.svelte`, `web/src/pages/JobPage.svelte`, `web/src/lib/live.svelte.ts` (event names), `tests/e2e/serve.ts`
- Test: `tests/e2e/ai.spec.ts`, `web/src/lib/format.test.ts`

**Interfaces:**
- Consumes: `api.aiStatus()`, `api.reparseJob(id)`, the `ai.stateChanged` and `job.updated` live events, `Job.parseState`, `Job.parseError`, `Job.match` and `Job.fieldSources`.
- Produces: `verdictLabel(v): string`: strong → "Strong match", good → "Good match", stretch → "Stretch", weak → "Weak match".
- `serve.ts`:
  - Builds the app with a `FakeAiProvider` in one of three modes: `smart` (the default), `fail` or `slow`. `POST /__test/ai { mode }` sets the mode, and `/__test/reset` puts back `smart`.
  - It also writes `profile/master-profile.md` into its temporary root.
  - Smart parse: the first non-empty line is the title and the second is the company. The first `$…` amount or range is the salary (text, min, max, AUD, year). Lines starting with `- ` or `• ` are the requirements.
  - Smart rating: `{ verdict: 'good', score: 72, why: ['Matches your TypeScript experience'], whyNot: ['Asks for 5 years of Go'], dealBreakers: [], salaryNote: null }`.
  - Fail mode rejects with `AiUnavailableError("Can't reach the AI at http://127.0.0.1:8080/v1. Check that it's running, or pick another AI in Settings.")`.

Exact copy:
- **Pill:**
  - off: "AI off" (title "The AI starts when it's needed.")
  - starting: "AI starting…"
  - ready: "AI ready"
  - busy: "AI working…"
  - error: "AI problem" (title = the detail; it links to `/settings#ai`)
- **ParseState:**
  - pending: "Reading the ad…" (`role="status"`)
  - failed: "Couldn't read the ad. {parseError}", plus a button **Parse again**
  - done or none: nothing
  - When any field's source is `ai`, a quiet line under the facts: "Some details were filled in by the AI. Press E to check them."
- **MatchPanel** (only when `job.match` is set):
  - A heading "Match", then "{verdictLabel} · {score}".
  - Lists headed "Why it fits", "Why it might not" and "Deal-breakers" (each shown only when it isn't empty).
  - The salary note as a paragraph.

- [ ] **Step 1: Write the failing tests** (`tests/e2e/ai.spec.ts`):

```ts
test('a pasted ad is saved at once, then the AI fills in the role, company, salary and requirements')
test('the match rating shows on the job')
test('when the AI is down, the job says why, and Parse again works once it is back')  // mode fail → banner; mode smart → click Parse again → fields appear
test('the header pill shows the AI state and changes live')                           // "AI off" → after a parse, "AI ready"
```
Unit: `verdictLabel` cases.
- [ ] **Step 2: Run `npm run test:e2e -- ai.spec.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm run test:e2e`.** Expected: PASS in Firefox and Chromium.

---

### Task 12: Edit dialog that keeps your typing; friendly errors (F6, F7)

**Files:**
- Create: `web/src/lib/edit-job.ts`, `web/src/lib/errors.ts`
- Modify: `web/src/components/EditJobDialog.svelte`, `web/src/pages/JobPage.svelte` (remove `{#key sheet.job.updatedAt}`), every `catch` that shows `(err as Error).message` (use `friendlyError`), `App.svelte`, `SettingsPage.svelte` and `JobPage.svelte` (archive) for the unhandled rejections
- Test: `web/src/lib/edit-job.test.ts`, `web/src/lib/errors.test.ts`, `tests/e2e/job.spec.ts`

**Interfaces (Produces):**
- `type EditForm = { title, company, agency, location, workMode, employmentType, salary, closingDate, dateApplied, summary, requirements }` (all strings, except the two enums)
- `formFromJob(job: Job): EditForm`. `salary` is `job.salary.text ?? formatSalary(job.salary)`, so a salary that came as min and max shows in the box.
- `buildPatch(start: EditForm, now: EditForm, job: Job): UpdateJobRequest` includes only the keys where `now` differs from `start`. A changed salary becomes `{ ...job.salary, text }`, with min and max kept. Blank dates become null, and requirements are split into lines.
- `friendlyError(err: unknown): string`:
  - A `TypeError` from `fetch` gives "Can't reach Job Registry. Check that it's still running, then try again."
  - An `ApiError` gives its message with zod's `✖ ` removed and the `→ at …` lines dropped, joined with a space.
  - Another `Error` gives its message. Anything else gives "Something went wrong."

The dialog takes its `start` form when it opens, and never re-creates itself while open. On save, an empty patch closes the dialog without a request.

- [ ] **Step 1: Write the failing tests:**

```ts
// edit-job.test.ts
it('a patch holds only the fields you changed')
it('a salary shown from min and max is sent only if you change it, keeping min and max')
it('no changes means an empty patch')
// errors.test.ts
it('a network failure says the app may have stopped'); it('zod symbols are removed from validation messages')
// job.spec.ts
test('the Edit dialog stays open with your typing when the AI updates the job, and saves only what you changed')
//   open Edit, type a new Role, POST /jobs/:id/reparse (smart fake fills salary), wait for the salary on the sheet behind,
//   check the dialog is still open with the typed Role, save → Role is yours, salary still from the AI
```
- [ ] **Step 2: Run `npx vitest run web/src/lib` and `npm run test:e2e -- job.spec.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test` and `npm run test:e2e`.** Expected: PASS.

---

### Task 13: Settings page — the AI section

**Files:**
- Modify: `web/src/pages/SettingsPage.svelte`
- Test: `tests/e2e/settings.spec.ts`

The section is `<section id="ai" aria-labelledby="ai-heading">`, with the heading "AI". Exact labels:
- **"AI server"**: a select of the `AI_PRESETS` labels. Picking a preset sets **Server address** to that preset's address (unless it's custom) and **Start and stop llama-server for me** to the preset's `managed` value.
- **"Server address"**
- **"Model"**, with the hint "Needed for Ollama, LM Studio and custom servers, for example qwen3:8b."
- For the llama-server preset only:
  - **"Start and stop llama-server for me"** (checkbox)
  - **"Program"**
  - **"Arguments (one per line)"**
- **"Stop the AI after this many idle minutes"**
- Buttons: **Save AI settings** (toast "AI settings saved.") and **Test connection**. While testing, the button reads "Testing…". The result is shown in a `role="status"` paragraph.
- A line from `ratingsStatus().detail`.

- [ ] **Step 1: Write the failing tests:**

```ts
test('choosing Ollama fills in its address, and saving keeps it after a reload')
test('Test connection shows how the AI answered')        // the fake replies → "Connected to … It replied in"
test('Test connection asks for a model when Ollama has none')
```
- [ ] **Step 2: Run `npm run test:e2e -- settings.spec.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it again.** Expected: PASS in both browsers.

---

### Task 14: Parse quality check, AI download, docs, Windows checklist

**Files:**
- Create: `scripts/eval-parse.ts`, `scripts/eval-score.ts`, `tests/eval-score.test.ts`, `tests/fixtures/ads/README.md`, three made-up example ads with `.expected.json`, `scripts/download-ai.ps1`, `download-ai.bat`, `docs/checklists/phase-2-windows.md`
- Modify: `package.json` (`"eval:parse": "node scripts/eval-parse.ts"`), `scripts/setup.ps1` (offer the download), `tests/windows-scripts.test.ts` (new scripts are ASCII and CRLF), `README.md` (the AI section), `docs/architecture.md` (§5, §6.1, §6.2, §8, §9, §12, §15), `docs/plan.md` (thinking switch), `CLAUDE.md`

**Interfaces (Produces):**
- `scoreParse(expected: Partial<ParsedJob>, actual: ParsedJob): Record<string, boolean>`. Only fields in `expected` are scored.
  - Text fields: equal after lower-casing, trimming, squashing spaces and dropping "pty ltd" or "limited".
  - Enums and dates: exactly equal.
  - Salary: min and max each within 1%, and the period equal.
  - Lists: at least 70% of the expected items are found, where an item counts as found when at least half its words appear in some actual item.
- `eval-parse.ts`:
  - Copies `config/settings.json` (if it exists) into a temporary config folder, and builds the app with an in-memory database.
  - For each `tests/fixtures/ads/*.txt` that has a `.expected.json`, it runs `ai.parseJob` and prints a per-ad line with the time and the misses.
  - At the end it prints a per-field table ("field, correct, total, %") and the average time. It exits 0. It's a report, not a test.

`download-ai.ps1`:
1. Downloads both pinned zips into `ai\downloads\`, and the model into `ai\models\`. It uses `curl.exe -L --fail -C -` (built into Windows 10 and 11) so a broken download can resume.
2. Checks each file's SHA-256 against the digests copied into the script from the GitHub release API and the Hugging Face LFS ids.
3. Unzips both zips into `ai\llama.cpp\`.
4. Prints "The AI is ready. Start Job Registry and press Test connection in Settings." Any failure stops with a sentence saying which file failed and that running `download-ai.bat` again resumes it.

`setup.ps1` asks "Download the AI now (Bonsai 2, about 7.6 GB)? (y/N)". Both new scripts stay ASCII with CRLF.

Docs:
- **Architecture:**
  - §6.1: the thinking switch is `reasoning_effort`.
  - §6.2: `detail` and `onStateChange`.
  - §8: the `RATING_CACHE` columns are `ad_key, profile_hash, rating_json, created_at`.
  - §9: `GET /ai/status`, `POST /ai/test`, `POST /ratings { capture, key? }`, `GET /ratings/status`, and reparse served by `enrich`.
  - §12.4: the default model path.
  - §15: the widened adapter rule.
- **plan.md:** the "AI module design" thinking line.
- **README:** "Choosing the AI", "Using Ollama or LM Studio instead", "Checking how well it reads ads (npm run eval:parse)".
- **Windows checklist:**
  - The download, Test connection with Bonsai, and a pasted real Seek ad filled in within about 20 seconds.
  - After 15 idle minutes, `nvidia-smi` shows the memory freed. `stop.bat` leaves no `llama-server.exe` in Task Manager.
  - A llama-server you start by hand is used and left running.
  - Switching to Ollama (pick a model) works with no code change.
  - `npm run eval:parse` with your real ads.

- [ ] **Step 1: Write the failing tests:** `scoreParse` cases (company "Atlassian Pty Ltd" vs "atlassian" → true; salary 90000 vs 90500 → true, vs 95000 → false; list recall) and the Windows-script checks for `download-ai.ps1` and `download-ai.bat`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**, including fetching the four SHA-256 digests (GitHub release asset `digest`; Hugging Face `lfs.oid`) into the script.
- [ ] **Step 4: Run `npm test`, then `npm run eval:parse` against the fake server** (`startFakeOpenAiServer` with the custom preset, via a temporary settings file) to prove the tool runs end to end. Expected: PASS, and a report prints.

---

### Task 15: Phase 2 verification and final review

- [ ] **Step 1:** Run `npm test` and `npm run test:e2e`. Expected: all pass, in both browsers.
- [ ] **Step 2:** Plant a bad import (`ai/service.ts` importing `../jobs/index.ts` at runtime), confirm `check:deps` fails, then remove it byte for byte.
- [ ] **Step 3:** Smoke test on macOS: start `node tests/fakes/fake-llama-server.ts --port 8089`. Run the server with a temporary root whose settings point the custom preset at it. Paste an ad through the API, and see it read and rated.
- [ ] **Step 4:** Dispatch a fresh Opus reviewer over the whole phase. Fix every critical and important finding with a test that fails first.
- [ ] **Step 5:** Update CLAUDE.md (Phase 2 built, its checklist, notes for Phase 3) and close the ledger.
