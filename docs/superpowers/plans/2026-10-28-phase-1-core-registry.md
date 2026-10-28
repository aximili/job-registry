# Phase 1 — Core Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local job registry that runs from `start.bat`. You can save jobs by pasting text or a link, track status, notes, contacts and calls, and find any job in under 2 seconds by typing part of a company name or phone number. There's no AI and no extension yet.

**Architecture:** A Node.js server (Fastify, TypeScript run directly) split into feature modules. Each module owns its SQLite tables and exposes only `index.ts`. They talk through public services and a typed event bus, and are wired together in `server/app.ts`. A Svelte 5 dashboard is built by Vite and served by the same server. Shared zod contracts define every API body.

**Tech stack:**
- Node.js ≥ 24 (developed on 26.12)
- TypeScript 6.0.x
- Fastify 5, @fastify/static 10
- better-sqlite3 13 (with FTS5)
- zod 4, pino, linkedom, @mozilla/readability
- Svelte 5, Vite 8, svelte-check 4
- Vitest 5, Playwright 1.64, dependency-cruiser 18

**Spec:** [docs/plan.md](../../plan.md) (Phase 1) and [docs/architecture.md](../../architecture.md). Read both. This plan argues from them.

## Global Constraints

**Toolchain and code style**
- **Node:** `engines.node` is `">=24"`. `.nvmrc` is `26`. The server runs with `node server/main.ts`, with no build step.
- **TypeScript 6.0.x, not 7.x**, because `svelte-check` needs `^5 || ^6`.
- **tsconfig:** `"erasableSyntaxOnly": true`, `"verbatimModuleSyntax": true`, `"allowImportingTsExtensions": true`, `"noEmit": true`, `"module": "nodenext"`, `"strict": true`.
- **Imports:** relative imports always include the `.ts` extension. Types use `import type`. No `enum`, no constructor parameter properties, no `namespace`.

**Server and API**
- **Address:** the server binds to `127.0.0.1` only. The port comes from settings, default `4777`.
- **API:** everything sits under `/api/v1`. Every request body, query and response is a zod schema in `shared/contracts/`.
- **Errors** always look like `{ "error": { "code", "message" } }`. The codes are `validation` 400, `not_found` 404, `conflict` 409, `forbidden` 403, `ai_unavailable` 503 and `internal` 500.
- **Module rules:** architecture.md §4 and §15. `npm run check:deps` must pass after every task. Never weaken a rule to make it pass.

**Data**
- **Migrations:** only add new numbered files in `server/core/db/migrations/`. Never edit an applied one. This phase creates `001_init.sql` only.
- **Time:** stored timestamps are ISO 8601 UTC from `Date#toISOString()`. Local dates are `YYYY-MM-DD`, built from local date parts (`shared/dates.ts`).
- **Shown dates:** `28 Oct 2026` style, built by hand from a month-name array, not with `Intl`.
- **Tests** run with `TZ=Australia/Sydney`, set in `vitest.config.ts` under `test.env`.

**Default statuses** (from plan.md; ids are fixed):

| id | label | closed | setsAppliedDate |
|----|-------|--------|-----------------|
| `saved` | Saved | false | false |
| `applied` | Applied | false | **true** |
| `screening` | Screening | false | false |
| `interview_1` | Interview 1 | false | false |
| `interview_2` | Interview 2 | false | false |
| `final_interview` | Final interview | false | false |
| `offer` | Offer | false | false |
| `accepted` | Accepted | false | false |
| `rejected` | Rejected | **true** | false |
| `withdrawn` | Withdrawn | **true** | false |
| `no_response` | No response | **true** | false |

`order` follows the table: 10, 20, 30, and so on.

**Writing**
- **Plain, short English and Australian spelling** in UI text, comments and docs.
- **Exact UI copy** is given in each task. Use it verbatim.

**Version control:** the user stages and commits by hand. No step in this plan runs `git add`, `git commit` or any command that writes to git. Leave the edits in place.

**Not in Phase 1:** the AI, the extension, documents, the profile, email, ratings and enrich. Don't create those modules or their tables.

## Review Focus

These are the failure modes most likely to bite a real person, and that the spec doesn't spell out. Each one has a pinned test in the task that owns the code.

1. **Search text with special characters**, such as `C++`, `AT&T`, `node.js`, `"senior`, `-`, `(` or a lone `*`. These must never cause an error. The search should still find what the letters and digits match. → Task 12
2. **Applied date across the UTC day boundary.** A status change at 9:30 am in Sydney (22:30 UTC the day before) must record the **Sydney** date. → Task 8
3. **A hand-edited `settings.json` with a mistake** (bad JSON, or a duplicate status id). The app must refuse to start with a message that names the file and the problem, and must **never overwrite** your file. → Task 5
4. **A job with no title or company**, for example from a blocked link where you left the fields empty. The list, search results and call sheet must show "Untitled role" and "Unknown company", never blank space or a crash. → Tasks 8 and 14
5. **Messy pasted text**, such as Windows line breaks (`\r\n`), non-breaking spaces, emoji or a 60,000-character ad. It must save in full, display properly and be searchable. → Tasks 7 and 8

---

## File map

```
package.json, package-lock.json, tsconfig.json, vitest.config.ts, playwright.config.ts,
.dependency-cruiser.cjs, .gitignore, .nvmrc, README.md
setup.bat, start.bat, stop.bat, start.sh
scripts/      setup.ps1, port.mjs
config/       settings.example.json
shared/       phone.ts, canonical-url.ts, dates.ts, api-client.ts
shared/contracts/  common.ts, capture.ts, jobs.ts, notes.ts, contacts.ts, search.ts,
                   callsheet.ts, settings.ts, system.ts, index.ts
server/       main.ts, app.ts
server/core/  config.ts, errors.ts, events.ts, logger.ts
server/core/db/    db.ts, migrations/001_init.sql
server/core/http/  module.ts, validate.ts, security.ts, errors.ts, static.ts
server/modules/<name>/  index.ts, service.ts, repo.ts (if it owns tables), routes.ts, *.test.ts
   names: settings, system, capture, jobs, notes, contacts, search, callsheet, live
   extra files: capture/jsonld.ts, capture/text.ts, jobs/match.ts, search/query.ts
web/          index.html, vite.config.ts, tsconfig.json
web/src/      main.ts, App.svelte, app.css
web/src/lib/  api.ts, live.svelte.ts, router.svelte.ts, format.ts, keys.ts, timeline.ts, statuses.ts
web/src/components/  Header, SearchBox, JobList, StatusBadge, CallSheet, StatusPicker, PeopleList,
                     LogCallDialog, NotesPanel, Timeline, AdText, EditJobDialog, NewJobDialog, SamePrompt
web/src/pages/       HomePage, JobPage, SettingsPage
tests/helpers/test-app.ts
tests/architecture/deps.test.ts
tests/e2e/    serve.ts, helpers.ts, fixtures/, search.spec.ts, job.spec.ts, new-job.spec.ts, settings.spec.ts
docs/checklists/phase-1-windows.md
```

---

### Task 1: Project scaffold and shared pure helpers

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.nvmrc`
- Create: `shared/phone.ts`, `shared/canonical-url.ts`, `shared/dates.ts`
- Test: `shared/phone.test.ts`, `shared/canonical-url.test.ts`, `shared/dates.test.ts`

**Interfaces:**
- Produces:
  - `phoneDigits(raw: string): string`
  - `queryDigits(q: string): string | null`
  - `canonicalJobUrl(input: string): { canonicalUrl: string; sourceSite: 'seek' | 'linkedin' | 'indeed' | 'other'; externalId: string | null }`. Throws `Error('Invalid URL')`.
  - `localDate(d: Date): string`, which returns `YYYY-MM-DD` from local date parts.
  - npm scripts: `typecheck`, `check:deps` (added in Task 3), `test`, `test:unit`.

- [ ] **Step 1: Scaffold.**
  - Run `npm init -y`, then set `"name": "job-registry"`, `"private": true`, `"type": "module"` and `"engines": {"node": ">=24"}`.
  - Install the dev dependencies: `typescript@~6.0.3 @types/node vitest`. Install the dependency `zod`.
  - Scripts:
    - `"typecheck": "tsc --noEmit -p tsconfig.json"`
    - `"test:unit": "vitest run"`
    - `"test": "npm run typecheck && vitest run"`. Task 3 adds `check:deps` to this.
  - tsconfig:
    - Use the Global Constraints options, plus `"target": "es2024"`, `"lib": ["es2024"]` and `"types": ["node"]`.
    - `include`: `["server", "shared", "tests", "scripts", "*.ts"]`. `exclude`: `["web"]`.
  - vitest config:
    - `include`: `server/**/*.test.ts`, `shared/**/*.test.ts`, `tests/**/*.test.ts`, `web/src/**/*.test.ts`. `exclude`: `tests/e2e/**`.
    - `test.env = { TZ: 'Australia/Sydney' }`.
  - `.gitignore`: `node_modules/`, `data/`, `config/settings.json`, `config/secrets.json`, `ai/`, `web/dist/`, `test-results/`, `playwright-report/`.

- [ ] **Step 2: Write the failing tests** (table-driven, with `it.each`):

```ts
// phone.test.ts
['0412 345 678', '0412345678'], ['+61 412 345 678', '0412345678'], ['+61 (0)412 345 678', '0412345678'],
['0061 412 345 678', '0412345678'], ['61412345678', '0412345678'], ['(02) 9876 5432', '0298765432'],
['+61 2 9876 5432', '0298765432'], ['+44 20 7946 0958', '442079460958'], ['', '']
// queryDigits
['0412', '0412'], ['+61 412', '0412'], ['345 678', '345678'], ['12', null], ['atl', null], ['Interview 2 2025', null]

// canonical-url.test.ts — input → { canonicalUrl, sourceSite, externalId }
'https://www.seek.com.au/job/81234567?type=standard&ref=search'           → 'https://www.seek.com.au/job/81234567', 'seek', '81234567'
'https://www.seek.com.au/software-engineer-jobs/in-All-Sydney-NSW?jobId=81234567&type=standard' → same
'https://seek.com.au/job/81234567'                                         → same
'https://www.seek.co.nz/job/123'                                           → 'https://www.seek.co.nz/job/123', 'seek', '123'
'https://www.linkedin.com/jobs/view/4012345678/?trk=abc'                   → 'https://www.linkedin.com/jobs/view/4012345678/', 'linkedin', '4012345678'
'https://au.linkedin.com/jobs/view/senior-engineer-at-atlassian-4012345678' → same
'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=engineer' → same
'https://au.indeed.com/viewjob?jk=a1b2c3d4e5f60718&from=serp'             → 'https://au.indeed.com/viewjob?jk=a1b2c3d4e5f60718', 'indeed', 'a1b2c3d4e5f60718'
'https://au.indeed.com/jobs?q=engineer&l=Sydney&vjk=a1b2c3d4e5f60718'     → same
'https://Careers.Example.com/Jobs/123/?utm_source=x&b=2&a=1&gclid=z#apply' → 'https://careers.example.com/Jobs/123?a=1&b=2', 'other', null
'not a url' → throws 'Invalid URL'

// dates.test.ts (TZ=Australia/Sydney)
localDate(new Date('2026-10-28T22:30:00Z')) === '2026-10-29'
localDate(new Date('2026-10-28T12:00:00Z')) === '2026-10-28'
```

- [ ] **Step 3: Run `npx vitest run shared`.** Expected: FAIL, because the modules aren't found.

- [ ] **Step 4: Implement.**
  - **`phoneDigits`:** remove non-digits.
    - If the raw text starts with `+61`, or the digits start with `0061`, drop the `61`/`0061`. Then prefix `0` unless the rest already starts with `0`.
    - Otherwise, if there are 11 digits starting with `61`, replace the `61` with `0`.
  - **`queryDigits`:** returns null unless the query has only digits, spaces and `+-().`, with at least 3 digits. Then it applies the same `+61` rule, without the 11-digit rule.
  - **`canonicalJobUrl`:**
    - Lowercase the host and drop the hash.
    - Seek, LinkedIn and Indeed follow the cases above. LinkedIn uses host `www.linkedin.com`, path `/jobs/view/{id}/`, and the id is the trailing digits of the slug. Indeed keeps its host.
    - For `other`, drop `utm_*`, `gclid`, `fbclid`, `mc_cid` and `mc_eid`. Sort the remaining params and remove the trailing slash (except on `/`).

- [ ] **Step 5: Run `npm test`.** Expected: PASS, with typecheck clean.

---

### Task 2: Shared contracts and the typed API client

**Files:**
- Create: `shared/contracts/{common,parsed-job,capture,jobs,notes,contacts,search,callsheet,settings,system,index}.ts`, `shared/api-client.ts`. `parsed-job.ts` exists so that `capture.ts` and `jobs.ts` don't import each other, which would be a cycle. The import direction is `parsed-job` ← `capture` ← `jobs`.
- Test: `shared/contracts/contracts.test.ts`, `shared/api-client.test.ts`

**Interfaces.** These names are used by every later task. Each is a zod schema plus a type of the same name, `z.infer`.
- **`common`:**
  - `Id` (positive int), `IsoDateTime` (`z.iso.datetime()`), `LocalDate` (`z.iso.date()`)
  - `ErrorCode` = enum `validation | not_found | conflict | forbidden | ai_unavailable | internal`
  - `ErrorBody`
- **`capture`:**
  - `SourceSite` = `seek | linkedin | indeed | other | pasted`
  - `Capture` = `{ sourceUrl: string|null, canonicalUrl: string|null, sourceSite, externalId: string|null, title?: string, company?: string, location?: string, jdText: string (may be ''), structured?: ParsedJob.partial(), capturedAt: IsoDateTime }`
  - `CapturePreviewRequest` = `{ url: string(url) } | { text: string(min 1) }`
  - `CapturePreviewResponse` = `{ capture, warning: string|null }`
- **`parsed-job`:**
  - Enums: `WorkMode` (`onsite|hybrid|remote|unknown`), `EmploymentType` (`full-time|part-time|contract|temporary|casual|unknown`), `SalaryPeriod` (`year|day|hour`).
  - `Salary` = `{ min: int|null, max: int|null, currency: string|null, period: SalaryPeriod|null, text: string|null }`
  - `ParsedJob`: exactly as architecture.md §6.6, but `title` and `company` are `string|null`.
- **`jobs`:**
  - Enums: `FieldSource` (`user|ad|ai`), `ParseState` (`none|pending|done|failed`), `StatusSource` (`manual|extension|email`).
  - `EditableJobFields` = `{ title, company, agency, location, workMode, employmentType, salary, closingDate: LocalDate|null, summary, requirements, niceToHave, responsibilities, dateApplied: LocalDate|null }`. All are nullable where ParsedJob allows it.
  - `Job` = `EditableJobFields & { id, status: string, adContact, fieldSources: Record<string, FieldSource>, parseState, parseError: string|null, matchVerdict: string|null, matchScore: int|null, archived: boolean, createdAt, updatedAt }`
  - `JobSummary` = `{ id, title, company, agency, location, status, dateApplied, archived, updatedAt }`
  - `Posting` = `{ id, jobId, canonicalUrl: string|null, sourceSite, externalId: string|null, sourceUrl: string|null, jdText, capturedAt }`
  - `StatusChange` = `{ id, jobId, fromStatus: string|null, toStatus, source: StatusSource, changedAt }`
  - `JobCheckRequest` = `{ canonicalUrl: string|null, sourceSite, externalId: string|null, title?: string, company?: string, location?: string }`
  - `ExactMatch` = `{ jobId, title, company, status, dateApplied }`
  - `Candidate` = `ExactMatch & { agency, location, sourceSites: SourceSite[], strength: 'likely'|'possible' }`
  - `JobCheckResponse` = `{ exact: ExactMatch|null, candidates: Candidate[] }`
  - `SaveDecision` = `'new' | { linkTo: Id }`
  - `SaveJobRequest` = `{ capture, fields?: EditableJobFields.partial(), status?: string, decision?: SaveDecision, source?: StatusSource }`
  - `SaveJobResponse` = discriminated union on `result`: `created` (job), `linked` (job), `exists` (job), `needs_decision` (candidates)
  - `UpdateJobRequest` = `EditableJobFields.partial().extend({ archived: boolean.optional() })`
  - `ChangeStatusRequest` = `{ status: string }`
  - `ListJobsQuery` = `{ status: 'open'|'closed'|'all'|string (comma-separated ids), default 'open'; archived: boolean, default false (coerced from 'true'/'false'); sort: 'updated'|'applied'|'company', default 'updated' }`
  - `AddPostingRequest` = `{ capture }`
  - `PostingLookupResponse` = `{ match: ExactMatch|null }`
- **`notes`:** `Note` = `{ id, jobId, body, createdAt, updatedAt }`, and `NoteBodyRequest` = `{ body: string }`.
- **`contacts`:**
  - `Relation` (`recruiter|hiring_manager|referrer|other`)
  - `Contact` = `{ id, name, role, organisation, email, phone, linkedinUrl, notes, createdAt, updatedAt }`. Everything except `name` is nullable.
  - `CreateContactRequest` (`name` min 1, others optional) and `UpdateContactRequest` (partial)
  - `JobContact` = `Contact & { relation, lastInteractionAt: IsoDateTime|null }`
  - `LinkContactRequest` = `{ contactId, relation: default 'recruiter' }`
  - `InteractionKind` (`call|email|meeting|message`)
  - `Interaction` = `{ id, contactId: Id|null, contactName: string|null, jobId: Id|null, kind, happenedAt, notes }`
  - `LogInteractionRequest` = `{ contactId?: Id|null, newContact?: CreateContactRequest, jobId?: Id|null, kind: default 'call', happenedAt?: IsoDateTime, notes: string, default '' }`
- **`search`:**
  - `SearchHit` = `{ kind:'job', jobId, title, company, agency, status, dateApplied, snippet: string|null } | { kind:'contact', contactId, name, organisation, phone, snippet: string|null }`
  - `SearchResponse` = `{ hits: SearchHit[] }`
  - `RebuildSearchResponse` = `{ jobs: int, contacts: int }`
- **`callsheet`:** `CallSheet` = `{ job: Job, postings: Posting[], history: StatusChange[], people: JobContact[], notes: Note[], interactions: Interaction[] }`. Lists are newest first.
- **`settings`:**
  - `Status` = `{ id: /^[a-z0-9_]+$/, label: min 1, closed, order: int, setsAppliedDate }`
  - `Settings` = `{ server: { port: default 4777 }, backups: { dir: default 'data/backups', keep: default 14 }, statuses: default DEFAULT_STATUSES }`. Every section has `.default(...)`, so `Settings.parse({})` gives the full defaults.
  - `UpdateSettingsRequest` = `{ server?, backups?, statuses? }`
  - `DEFAULT_STATUSES`, `DEFAULT_SETTINGS`
- **`system`:** `Health` = `{ ok: true, version: string, uptimeSec: number }`, and `BackupResponse` = `{ file: string }`.
- **`api-client`:**
  - `createApiClient(opts: { baseUrl: string; fetch?: typeof fetch; headers?: Record<string,string> }): ApiClient`
  - `class ApiError extends Error { code: ErrorCode; status: number }`. Assign the fields in the constructor body.
  - Methods:
    - System and capture: `health()`, `previewCapture(req)`.
    - Jobs: `checkJob(req)`, `saveJob(req)`, `listJobs(q?: Partial<ListJobsQuery>)`, `getJob(id)`, `updateJob(id, patch)`, `changeStatus(id, status)`, `addPosting(id, capture)`, `lookupPosting(url)`, `getCallSheet(id)`.
    - Search: `search(q, opts?: {signal})`.
    - Notes: `listNotes(jobId)`, `addNote(jobId, body)`, `updateNote(id, body)`, `deleteNote(id)`.
    - Contacts: `listContacts(q?)`, `createContact(req)`, `updateContact(id, patch)`, `linkContact(jobId, req)`, `unlinkContact(jobId, contactId)`, `logInteraction(req)`, `listInteractions(jobId)`.
    - Settings and maintenance: `getSettings()`, `updateSettings(patch)`, `rebuildSearch()`, `backupNow()`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('parses a minimal pasted capture')            // sourceSite 'pasted', nulls, jdText 'x', capturedAt ISO
it('accepts both save decisions')                // 'new' and { linkTo: 3 } pass; { linkTo: 'x' } fails
it('rejects a status id with spaces')            // Status.safeParse({ id: 'Interview 1', ... }).success === false
it('fills every settings default from {}')       // Settings.parse({}) deep-equals DEFAULT_SETTINGS; statuses.length === 11
// api-client, using a fake fetch that records calls:
it('saveJob POSTs JSON to /api/v1/jobs and returns the parsed body')
it('turns an error body into ApiError with code and status')       // 404 { error: { code: 'not_found', message: 'Job 9 not found' } }
it('search encodes q and passes the abort signal')                 // URL ends with '/api/v1/search?q=AT%26T'
it('listJobs builds the query string from the given keys only')
it('throws ApiError internal "Unexpected response from the server." when the body does not match the schema')
```

- [ ] **Step 2: Run `npx vitest run shared`.** Expected: FAIL.
- [ ] **Step 3: Implement the schemas and the client.**
  - The client sends `content-type: application/json` only when there's a body.
  - It parses every response with the matching schema.
  - A `204` returns `undefined`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 3: Architecture check (dependency-cruiser)

**Files:**
- Create: `.dependency-cruiser.cjs`, `tests/architecture/deps.test.ts`
- Modify: `package.json`. Add the script `"check:deps": "depcruise server shared --config .dependency-cruiser.cjs"`. Task 14 adds `web/src` once that folder exists. Make `test` = `npm run typecheck && npm run check:deps && vitest run`.

**Interfaces:**
- Produces: `module.exports = { forbidden: [...], options: {...} }`, which the test imports.
- Rule names, which later tasks may see in failures:
  - `no-circular`
  - `module-private`
  - `foundation-no-module-deps`
  - `composite-allow-list-<module>`
  - `no-fastify-in-logic`
  - `sqlite-only-in-repos`
  - `shared-is-leaf`
  - `shared-npm-allow-list`
  - `clients-not-server`
  - `adapters-only-from-index`

- [ ] **Step 1: Write the failing test.** `deps.test.ts` uses dependency-cruiser's `cruise` API with the exported rules:

```ts
it('the real codebase has no violations')                     // cruise(['server','shared']) → summary.violations.length === 0
it('flags a foundation module importing another module')       // temp dir: server/modules/ai/service.ts imports ../jobs/index.ts → 'foundation-no-module-deps'
it('flags importing another module’s private file')            // server/modules/search/service.ts imports ../jobs/repo.ts → 'module-private'
it('flags a composite module outside its allow-list')          // server/modules/ratings/service.ts imports ../jobs/index.ts → 'composite-allow-list-ratings'
it('flags shared importing server code')                       // shared/x.ts imports ../server/app.ts → 'shared-is-leaf'
```

  - **Fixtures:** write the fixture files into `fs.mkdtempSync()`, then cruise with `{ baseDir: tmp }`.
  - **Assertion:** `violations.map(v => v.rule.name)` contains the expected rule.

- [ ] **Step 2: Run `npx vitest run tests/architecture`.** Expected: FAIL, because the config is missing.
- [ ] **Step 3: Write `.dependency-cruiser.cjs`** from architecture.md §4.2 and §15:
  - **Foundation modules:** `jobs|contacts|notes|ai|profile|capture|settings|system|live`.
  - **Composite allow-lists:**
    - `ratings → ai, profile`
    - `enrich → jobs, ai, ratings`
    - `documents → ai, profile, jobs`
    - `search → jobs, contacts, notes`
    - `callsheet → jobs, contacts, notes, documents`
    - `email → ai, jobs, contacts, notes`
  - **`module-private`:**

    ```
    from:   '^server/modules/([^/]+)/'
    to:     '^server/modules/[^/]+/'
    pathNot: ['^server/modules/$1/', '^server/modules/[^/]+/index\\.ts$']
    ```

  - **`no-fastify-in-logic`:** from `(service|repo)\.ts$` to `node_modules/(fastify|@fastify)/`.
  - **`sqlite-only-in-repos`:** from `^server/`, except `repo\.ts$`, `^server/core/db/` and `\.test\.ts$`, to `node_modules/better-sqlite3/`.
  - **`shared-npm-allow-list`:** from `^shared/` (non-test files) to `node_modules/`, except `zod` and `marked`.
  - **Options:** `tsConfig: { fileName: 'tsconfig.json' }`, `doNotFollow: { path: 'node_modules' }`, `exclude: { path: '(^|/)(dist|node_modules)/' }`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 4: Server core — config, errors, events, logger, database

**Files:**
- Create: `server/core/config.ts`, `server/core/errors.ts`, `server/core/events.ts`, `server/core/logger.ts`, `server/core/db/db.ts`, `server/core/db/migrations/001_init.sql`
- Test: `server/core/events.test.ts`, `server/core/logger.test.ts`, `server/core/config.test.ts`, `server/core/db/db.test.ts`
- Install: `better-sqlite3 pino` (deps), `@types/better-sqlite3` (dev)

**Interfaces:**
- **Config:**
  - `type AppPaths = { root, data, db, files, logs, config, settings, secrets, profile, templates, webDist }`. All are absolute, and `db` may be `':memory:'`.
  - `resolvePaths(root: string, overrides?: Partial<AppPaths>): AppPaths`. Defaults:
    - `data = root/data`, `db = data/jobs.db`, `files = data/files`, `logs = data/logs`
    - `config = root/config`, `settings = config/settings.json`, `secrets = config/secrets.json`
    - `profile = root/profile`, `templates = root/templates`, `webDist = root/web/dist`
  - `type Clock = () => Date`
- **Errors:** `class AppError extends Error { code: ErrorCode; status: number }`, with subclasses `NotFoundError`, `ValidationError`, `ConflictError`, `ForbiddenError` and `AiUnavailableError(message: string)`.
- **Events:**
  - The `type AppEvents` map:

    ```
    'job.saved':          { jobId }
    'job.updated':        { jobId; fields: string[] }
    'job.statusChanged':  { jobId; from: string|null; to: string; source: StatusSource }
    'posting.added':      { jobId; postingId }
    'note.added' | 'note.updated' | 'note.removed':  { jobId; noteId }
    'contact.saved':      { contactId; jobIds: number[] }
    'contact.linked' | 'contact.unlinked':  { contactId; jobId }
    'interaction.logged': { interactionId; contactId: number|null; jobId: number|null }
    'settings.changed':   { keys: string[] }
    ```

  - `interface EventBus { emit<K extends keyof AppEvents>(name: K, payload: AppEvents[K]): void; on<K>(name: K, handler: (p: AppEvents[K]) => void): () => void; onAny(handler: (name: keyof AppEvents, payload: unknown) => void): () => void }`
  - `createEventBus(logger: Logger): EventBus`
- **Logger:** `type Logger = import('pino').Logger`, `createLogger(opts: { dir: string|null; level?: string; now?: Clock }): Logger`, and `pruneLogs(dir: string, keepDays: number, now: Date): string[]`, which returns the deleted file names.
- **Database:** `type Db = import('better-sqlite3').Database`.
  - `openDb(file: string, opts?: { onBeforeMigrate?: (db: Db) => void }): Db`. It sets the pragmas `journal_mode = WAL` (file only), `foreign_keys = ON` and `busy_timeout = 5000`, then runs `migrate`.
  - `migrate(db: Db, dir: string, opts?): { from: number; to: number }`
  - `isConstraintError(err: unknown, kind: 'FOREIGNKEY' | 'UNIQUE'): boolean`

- [ ] **Step 1: Write the failing tests:**

```ts
it('runs handlers in order and keeps going when one throws')   // second handler still called; logger.error called once
it('on() returns an unsubscribe function'); it('onAny receives every event name and payload')
it('pruneLogs deletes app-*.log older than 14 days only')       // keeps newer logs and llama.log
it('resolvePaths builds every path from the root and applies overrides')
it('migrates an empty database to version 1 with all tables')   // jobs, postings, status_history, notes, contacts, job_contacts, interactions, search_index
it('does nothing on a second run')                              // { from: 1, to: 1 }
it('rolls back a failing migration and names the file')        // temp dir with 001 ok + 002 bad SQL → throws /002_bad\.sql/, user_version stays 1
it('calls onBeforeMigrate only when upgrading an existing database')
```

- [ ] **Step 2: Run `npx vitest run server/core`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The migrations directory is `new URL('./migrations/', import.meta.url)`. Apply each `NNN_*.sql` file whose number is above `user_version`, in its own transaction.
  - Log file name: `app-YYYY-MM-DD.log` (local date). Use `pino.multistream` to send logs to stdout plus a file when `dir` is set.
  - `001_init.sql`:

```sql
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY, title TEXT, company TEXT, agency TEXT, location TEXT,
  work_mode TEXT NOT NULL DEFAULT 'unknown', employment_type TEXT NOT NULL DEFAULT 'unknown',
  salary_min INTEGER, salary_max INTEGER, salary_currency TEXT, salary_period TEXT, salary_text TEXT,
  closing_date TEXT, status TEXT NOT NULL, date_applied TEXT, summary TEXT,
  requirements TEXT NOT NULL DEFAULT '[]', nice_to_have TEXT NOT NULL DEFAULT '[]',
  responsibilities TEXT NOT NULL DEFAULT '[]', ad_contact TEXT,
  field_sources TEXT NOT NULL DEFAULT '{}', parse_state TEXT NOT NULL DEFAULT 'none', parse_error TEXT,
  match_verdict TEXT, match_score INTEGER, match_json TEXT,
  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX jobs_status ON jobs(status, archived);
CREATE INDEX jobs_updated ON jobs(updated_at);
CREATE TABLE postings (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id),
  canonical_url TEXT UNIQUE, source_site TEXT NOT NULL, external_id TEXT, source_url TEXT,
  jd_text TEXT NOT NULL DEFAULT '', structured_json TEXT, captured_at TEXT NOT NULL
);
CREATE INDEX postings_job ON postings(job_id);
CREATE UNIQUE INDEX postings_site_id ON postings(source_site, external_id) WHERE external_id IS NOT NULL;
CREATE TABLE status_history (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id),
  from_status TEXT, to_status TEXT NOT NULL, source TEXT NOT NULL, changed_at TEXT NOT NULL
);
CREATE INDEX status_history_job ON status_history(job_id, changed_at);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id),
  body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX notes_job ON notes(job_id, created_at);
CREATE TABLE contacts (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, organisation TEXT, email TEXT, phone TEXT,
  phone_digits TEXT NOT NULL DEFAULT '', linkedin_url TEXT, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE job_contacts (
  job_id INTEGER NOT NULL REFERENCES jobs(id), contact_id INTEGER NOT NULL REFERENCES contacts(id),
  relation TEXT NOT NULL DEFAULT 'recruiter', PRIMARY KEY (job_id, contact_id)
);
CREATE INDEX job_contacts_contact ON job_contacts(contact_id);
CREATE TABLE interactions (
  id INTEGER PRIMARY KEY, contact_id INTEGER REFERENCES contacts(id), job_id INTEGER REFERENCES jobs(id),
  kind TEXT NOT NULL, happened_at TEXT NOT NULL, notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX interactions_job ON interactions(job_id, happened_at);
CREATE INDEX interactions_contact ON interactions(contact_id, happened_at);
CREATE VIRTUAL TABLE search_index USING fts5(
  kind UNINDEXED, ref_id UNINDEXED, title, people, notes, ad,
  tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
);
```

- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 5: Settings service

**Files:**
- Create: `server/modules/settings/{index,service}.ts`
- Test: `server/modules/settings/service.test.ts`

**Interfaces:**
- Consumes: `Settings`, `UpdateSettingsRequest`, `Status`, `DEFAULT_SETTINGS` (Task 2), `EventBus`, `ValidationError` (Task 4).
- Produces: `interface SettingsService { get(): Settings; update(patch: UpdateSettingsRequest): Settings; statuses(): Status[] }` and `createSettingsService(opts: { file: string; bus: EventBus }): SettingsService`. Routes come in Task 6.

- [ ] **Step 1: Write the failing tests:**

```ts
it('creates settings.json with defaults when it is missing')
it('reads an existing file and fills missing keys with defaults')
it('refuses invalid JSON, names the file, and leaves it untouched')
  // throws /settings\.json isn't valid JSON/ ; file bytes unchanged afterwards     (Review Focus 3)
it('refuses duplicate status ids on load and on update')
  // message exactly: "Status id 'applied' is used twice."                         (Review Focus 3)
it('update merges sections, writes the file, and emits settings.changed with the changed keys')
it('statuses() returns statuses sorted by order')
```

- [ ] **Step 2: Run `npx vitest run server/modules/settings`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - A schema error on load throws `ValidationError` with `z.prettifyError` text, prefixed with the file path.
  - Writes are atomic: write `settings.json.tmp`, then `renameSync`. Pretty JSON, 2 spaces, with a trailing newline.
  - `update` replaces whole top-level sections that are present in the patch.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 6: HTTP foundation — app, security, errors, system module, entry point

**Files:**
- Create: `server/core/http/{module,validate,security,errors,static}.ts`, `server/modules/settings/routes.ts`, `server/modules/system/{index,service,routes}.ts`, `server/app.ts`, `server/main.ts`, `tests/helpers/test-app.ts`
- Test: `server/core/http/security.test.ts`, `server/modules/system/system.test.ts`, `server/modules/settings/routes.test.ts`, `server/main.test.ts`
- Install: `fastify @fastify/static`

**Interfaces:**
- **Module shape:** `type HttpModule<S> = { service: S; routes: FastifyPluginAsync }`.
- **Validation:** `parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.infer<S>`. It throws `ValidationError(z.prettifyError(err))`.
- **Security:** `registerSecurity(http, opts: { port: number }): void`
- **Errors:** `registerErrorHandler(http, logger): void`
- **Static files:** `serveDashboard(http, webDist: string): Promise<void>`. It also installs the not-found handler.
- **Modules:**
  - `createSettingsModule(opts) → HttpModule<SettingsService>`. Routes: `GET /settings`, `PATCH /settings`.
  - `createSystemModule(opts: { db: Db; backupDir: () => string; keepBackups: () => number; now: Clock; version: string; onShutdown: () => void }) → HttpModule<SystemService>`, where `interface SystemService { health(): Health; backupNow(): Promise<string>; startDailyBackups(): () => void }`. Routes: `GET /health`, `POST /system/backup` → `BackupResponse`, `POST /system/shutdown` → 202, then `onShutdown()`.
- **App:**
  - `buildApp(opts: AppOptions): Promise<App>`
  - `type AppOptions = { paths: AppPaths; port?: number; logger?: Logger; now?: Clock; fetch?: typeof fetch; onShutdown?: () => void; version?: string }`
  - `type App = { http: FastifyInstance; db: Db; bus: EventBus; port: number; services: AppServices; close(): Promise<void> }`
  - Later tasks add to `AppServices` (`settings`, `system`, then `capture`, `jobs`, `notes`, `contacts`, `search`, `callsheet`).
- **Test helper:** `createTestApp(opts?: { now?: Clock; fetch?: typeof fetch; settings?: Partial<Settings> }): Promise<TestApp>`, where `TestApp = App & { root: string; request(method: string, url: string, body?: unknown, headers?: Record<string,string>): Promise<{ status: number; body: any }>; cleanup(): Promise<void> }`.
  - It uses a temp root, `db: ':memory:'` and port 4777.
  - `request` defaults the headers to `host: 127.0.0.1:4777`, plus `origin: http://127.0.0.1:4777` on writes.
- **Entry point:** `describeListenError(err: NodeJS.ErrnoException, port: number): string` in `main.ts`, exported for the test.

- [ ] **Step 1: Write the failing tests:**

```ts
it('GET /api/v1/health returns ok, version and uptime')
it('rejects a request whose Host is not 127.0.0.1 or localhost on the port')   // host 'evil.example' → 403 code 'forbidden'
it('rejects a write without an Origin, or from another website')               // none / 'https://evil.example' → 403
it('allows writes from the dashboard and from extension origins')              // 'moz-extension://abc', 'chrome-extension://xyz' → 200 on POST /system/backup
it('rejects text/plain bodies')                                                // 415
it('returns not_found JSON for unknown API routes')                            // GET /api/v1/nope → 404 { error: { code: 'not_found' } }
it('maps AppError subclasses and hides unknown errors')                        // test-only route throws Error('boom') → 500 'Something went wrong. See the log for details.'
it('backupNow writes jobs-YYYY-MM-DD-HHmmss.db and keeps only the newest N')   // keep 2, three calls with advancing clock → 2 files
it('GET and PATCH /settings round-trip and validate')                          // duplicate ids → 400
it('serves a plain message when the dashboard is not built')                   // GET / → 503 "The dashboard isn't built yet. Run setup.bat, or npm run build."
it('describeListenError explains a busy port')
  // EADDRINUSE → "Port 4777 is already in use. Job Registry may already be running: open http://127.0.0.1:4777/"
```

- [ ] **Step 2: Run `npx vitest run server`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Security** (an `onRequest` hook):
    - The allowed hosts are `127.0.0.1:{port}` and `localhost:{port}`.
    - On `POST`, `PATCH`, `PUT` and `DELETE`, the Origin must be `http://127.0.0.1:{port}` or `http://localhost:{port}`, or start with `moz-extension://` or `chrome-extension://`.
    - Call `http.removeContentTypeParser('text/plain')`.
  - **Not-found handler:**
    - `/api/` paths get a `not_found` JSON error.
    - Other GETs get `index.html` from `webDist` when it exists, or else the 503 message.
  - **Ordering in `app.ts`:** wire the modules in the order of architecture.md §4.4, and only the Phase 1 modules. Register every module's routes with the prefix `/api/v1`.
  - **Backup folder:** `backupDir()` resolves `settings.backups.dir` against `paths.root` when it's relative.
  - **`main.ts`:**
    1. Resolve the root as `new URL('..', import.meta.url)`, then the paths.
    2. Create the logger with `dir = paths.logs`, and prune the logs.
    3. `buildApp`, then `listen({ host: '127.0.0.1', port })`. On error, log `describeListenError` and exit 1.
    4. Call `backupNow()` once if the db file existed before start, then `startDailyBackups()`.
    5. On SIGINT or SIGTERM, close the app.
  - **Arch doc:** add `forbidden` (403) to the error table in architecture.md §9.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 7: Capture module — pasted text, links and JobPosting data

**Files:**
- Create: `server/modules/capture/{index,service,routes,jsonld,text}.ts`
- Test: `server/modules/capture/jsonld.test.ts`, `server/modules/capture/service.test.ts`, `server/modules/capture/routes.test.ts`
- Install: `linkedom @mozilla/readability`

**Interfaces:**
- **JobPosting data:** `extractJobPosting(html: string): { structured: Partial<ParsedJob>; descriptionText: string | null } | null`
- **Text helpers:** `htmlFragmentToText(html: string): string` and `readableText(html: string, url: string): { title: string | null; text: string }`. These are internal to the module.
- **Service:** `interface CaptureService { fromText(text: string): Capture; fromUrl(url: string): Promise<CapturePreviewResponse> }` and `createCaptureModule(opts: { fetch?: typeof fetch; now: Clock }): HttpModule<CaptureService>`.
- **Route:** `POST /captures/preview`.

- [ ] **Step 1: Write the failing tests.** Use HTML fixtures as inline strings.

```ts
it('maps a JobPosting with an AUD salary range')
  // baseSalary { currency:'AUD', value:{ minValue:150000, maxValue:170000, unitText:'YEAR' } }
  // → salary { min:150000, max:170000, currency:'AUD', period:'year', text:null }; company from hiringOrganization.name;
  //   location 'Sydney NSW' from addressLocality + addressRegion; employmentType FULL_TIME → 'full-time';
  //   validThrough '2026-11-30T00:00:00+11:00' → closingDate '2026-11-30'; jobLocationType TELECOMMUTE → workMode 'remote'
it('finds a JobPosting inside @graph or with an array @type')
it('skips script blocks that are not valid JSON')
it('returns null when there is no JobPosting')
it('fromText normalises messy pasted text but keeps all of it')             // (Review Focus 5)
  // '\r\n' → '\n'; ' ' → ' '; trailing spaces per line removed; 3+ blank lines → 1 blank line;
  // emoji kept; a 60,000-character ad keeps its full length; sourceSite 'pasted', URLs null
it('fromUrl uses JobPosting data and the description as the ad text')       // fake fetch 200 with JSON-LD
it('fromUrl falls back to readable page text when there is no JobPosting')
it('fromUrl explains a blocked site')
  // fake fetch 403 for a Seek URL → jdText '' and warning exactly:
  // "Seek didn't let the app download this page. Copy the ad text from your browser and paste it here instead."
  // for an 'other' site the sentence starts "That site didn't let…"; a thrown fetch or text under 200 chars → same warning
it('POST /captures/preview validates the body')                              // { url: 'not a url' } → 400 validation
```

- [ ] **Step 2: Run `npx vitest run server/modules/capture`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Fetch:** a 15-second timeout through `AbortSignal.timeout(15000)`. Headers: a current desktop Firefox `User-Agent`, plus `Accept-Language: en-AU,en;q=0.8`.
  - **Site labels:** `seek` → Seek, `linkedin` → LinkedIn, `indeed` → Indeed, otherwise "That site".
  - **Readable text:** `readableText` uses linkedom's `parseHTML` with Readability. If Readability can't handle a linkedom document, switch this one file to `jsdom`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 8: Jobs module — save, read, list, edit, status

**Files:**
- Create: `server/modules/jobs/{index,service,repo,routes}.ts`
- Test: `server/modules/jobs/service.test.ts`, `server/modules/jobs/routes.test.ts`

**Interfaces:**
- Consumes: the jobs contracts (Task 2), `Status`, `Db`, `EventBus`, `Clock`, errors, `localDate`.
- Produces:

```ts
interface JobsService {
  save(req: SaveJobRequest): SaveJobResponse;
  check(req: JobCheckRequest): JobCheckResponse;            // body in Task 9
  get(id: number): Job;                                     // NotFoundError "Job {id} not found"
  getSummaries(ids: number[]): JobSummary[];                // same order as ids, unknown ids skipped
  list(q: ListJobsQuery): JobSummary[];
  listIds(opts: { archived: boolean }): number[];
  update(id: number, patch: UpdateJobRequest): Job;
  changeStatus(id: number, status: string, source: StatusSource): Job;
  addPosting(jobId: number, capture: Capture): Job;         // body in Task 9
  lookupByUrl(url: string): PostingLookupResponse;          // body in Task 9
  listPostings(jobId: number): Posting[];
  listHistory(jobId: number): StatusChange[];
}
createJobsModule(opts: { db: Db; bus: EventBus; statuses: () => Status[]; now: Clock }): HttpModule<JobsService>
```

- **Routes:**
  - `POST /jobs` returns 201 for `created`, and 200 for `linked`, `exists` and `needs_decision`.
  - `GET /jobs`, `GET /jobs/:id`, `PATCH /jobs/:id`, `POST /jobs/:id/status`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('save creates the job, its first posting and the first status change together')  // result 'created', history [{from:null,to:'saved',source:'manual'}]
it('save takes fields from capture.structured and marks them as from the ad')       // fieldSources.company === 'ad'
it('user-entered fields win over ad fields and are marked user')
it('save with status applied sets dateApplied to the local date')                    // now 2026-10-28T22:30:00Z → '2026-10-29' (Review Focus 2)
it('save rejects an unknown status')                                                 // "Unknown status 'interviewing'."
it('save accepts a job with no title or company')                                    // title null, company null (Review Focus 4)
it('save keeps a 60,000-character ad in full')                                       // (Review Focus 5)
it('save sets parseState pending when there is ad text, otherwise none')
it('emits job.saved then posting.added after the transaction commits')
it('changeStatus logs history, and does nothing for the same status')
it('changeStatus to a setsAppliedDate status fills dateApplied only when empty')
it('update marks changed fields as user and emits job.updated with their names')
it('list filters open, closed, all and id lists, hides archived, and sorts')         // sort 'company' is case-insensitive, nulls last
it('get throws NotFoundError for an unknown id')
it('routes: POST /jobs → 201, POST /jobs/:id/status unknown → 400, GET /jobs/999 → 404')
```

- [ ] **Step 2: Run `npx vitest run server/modules/jobs`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Save, in Phase 1:**
    1. Exact match (Task 9 fills in `check`; for now, canonical URL only) → `exists`.
    2. Otherwise, if there's no decision and `check()` returns candidates → `needs_decision`.
    3. Otherwise create the job: insert the job, the posting and the history row in one `db.transaction`, then emit the events.
  - **Mapping JSON columns:** the repo turns rows into `Job` and checks JSON columns with zod.
  - **Arch doc:** update architecture.md §9. `POST /jobs` returns `{ result: created | linked | exists | needs_decision }`, and duplicates are not errors. A note added at save time is a second call, `POST /jobs/:id/notes`. `conflict` is used for "this ad is already on another job" and for edits to a sent document.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 9: Duplicates — matching, check, linking an ad, URL lookup

**Files:**
- Create: `server/modules/jobs/match.ts`
- Modify: `server/modules/jobs/service.ts`, `repo.ts`, `routes.ts`
- Test: `server/modules/jobs/match.test.ts`, extend `service.test.ts` and `routes.test.ts`

**Interfaces:**
- **Pure helpers:**
  - `normaliseCompany(name: string): string`
  - `titleTokens(title: string): Set<string>`
  - `titleSimilarity(a: string, b: string): number`
  - `findCandidates(input: { title?: string; company?: string; location?: string }, jobs: MatchableJob[]): Candidate[]`
  - `type MatchableJob = { id; title: string|null; company: string|null; agency: string|null; location: string|null; status; dateApplied: string|null; createdAt: string; sourceSites: SourceSite[] }`
- **Routes:** `POST /jobs/check`, `POST /jobs/:id/postings`, `GET /postings/lookup?url=`.

- [ ] **Step 1: Write the failing tests:**

```ts
it.each([['Atlassian Pty Ltd','atlassian'], ['Atlassian Australia','atlassian'],
         ['The Commonwealth Bank of Australia','commonwealth bank'], ['Canva Group Holdings','canva']])('normaliseCompany %s')
it.each([['Senior Software Engineer','Software Engineer (Senior)',1], ['Sr. Software Engineer','Senior Software Engineer',1],
         ['Senior Software Engineer - Platform','Senior Software Engineer',0.75], ['Software Engineer','Data Engineer',1/3]])('titleSimilarity')
it('same company and close title is a likely match')
it('agency ad with no employer, same title and city is a possible match')      // capture company 'Hays', job.agency 'Hays' also counts
it('different real companies are never matched')
it('a different city is not a possible match')
it('returns at most 3 candidates, likely first, then most similar, then newest')
it('check finds an exact match by canonical URL or by site id')
it('check ignores closed jobs and jobs created more than 183 days ago')
it('save with no decision returns needs_decision; with linkTo returns linked with 2 postings; with new returns created')
it('saving the same link twice returns exists')
it('addPosting refuses an ad already saved on another job')                   // ConflictError "This ad is already saved on job {id}."
it('lookupByUrl canonicalises first')                                          // a Seek search URL with ?jobId= finds the job saved from /job/{id}
```

- [ ] **Step 2: Run `npx vitest run server/modules/jobs`.** Expected: FAIL.
- [ ] **Step 3: Implement** from architecture.md §7.1 and decision 0010.
  - **Company suffixes** removed from the end, repeatedly, while more than one word remains: `pty ltd limited inc llc plc corp corporation co group holdings australia aust`. Then a trailing `of` or `and` is dropped. A leading `the` is dropped.
  - **Title tokens:**
    - Lowercase the title and split it on anything that isn't a letter or digit.
    - Expand `sr snr→senior`, `jr→junior`, `mgr→manager`, `eng→engineer`, `dev→developer`.
    - Drop `a an the of and at for in to with remote hybrid contract permanent full part time fte`.
    - Similarity is the Jaccard index of the two token sets.
  - **Thresholds:**
    - **likely:** the companies normalise to the same name, and similarity ≥ 0.6.
    - **possible:** not likely, similarity ≥ 0.8, and the cities are compatible: either one is missing, or the first word of each location is the same. Also, either a company is missing, or the capture's company equals the job's agency.
  - **Which jobs are considered:** `check` only looks at open jobs created in the last 183 days.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 10: Notes module

**Files:**
- Create: `server/modules/notes/{index,service,repo,routes}.ts`
- Test: `server/modules/notes/notes.test.ts`

**Interfaces:**
- `interface NotesService { add(jobId: number, body: string): Note; update(id: number, body: string): Note; remove(id: number): void; listForJob(jobId: number): Note[] }`
- `createNotesModule(opts: { db: Db; bus: EventBus; now: Clock }): HttpModule<NotesService>`
- **Routes:** `GET /jobs/:id/notes`, `POST /jobs/:id/notes` (201), `PATCH /notes/:id`, `DELETE /notes/:id` (204).

- [ ] **Step 1: Write the failing tests:**

```ts
it('add trims the body and refuses an empty note')     // "A note can't be empty."
it('lists notes newest first'); it('update and remove emit note.updated and note.removed')
it('adding a note to an unknown job is a 404')          // FK error mapped with isConstraintError → NotFoundError "Job 999 not found"
```

- [ ] **Step 2: Run `npx vitest run server/modules/notes`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 11: Contacts module — people, links to jobs, the call log

**Files:**
- Create: `server/modules/contacts/{index,service,repo,routes}.ts`
- Test: `server/modules/contacts/contacts.test.ts`

**Interfaces:**

```ts
interface ContactsService {
  create(req: CreateContactRequest): Contact;
  update(id: number, patch: UpdateContactRequest): Contact;
  get(id: number): Contact;
  list(q?: string): Contact[];                       // name/organisation/email contains q, or phone digits contain queryDigits(q); max 20
  listIds(): number[];
  linkToJob(jobId: number, req: LinkContactRequest): JobContact;
  unlink(jobId: number, contactId: number): void;
  listForJob(jobId: number): JobContact[];
  listJobIdsForContact(contactId: number): number[];
  findByPhoneDigits(digits: string): { contactId: number; jobIds: number[] }[];
  logInteraction(req: LogInteractionRequest): Interaction;
  listInteractionsForJob(jobId: number): Interaction[];   // newest first, with contactName
}
createContactsModule(opts: { db: Db; bus: EventBus; now: Clock }): HttpModule<ContactsService>
```

- **Routes:**
  - `GET /contacts?q=`, `POST /contacts`, `PATCH /contacts/:id`
  - `POST /jobs/:id/contacts`, `DELETE /jobs/:id/contacts/:contactId`
  - `POST /interactions`, `GET /jobs/:id/interactions`

- [ ] **Step 1: Write the failing tests:**

```ts
it('stores phone_digits normalised and finds a contact by any part of the number')   // '+61 412 345 678' found by '345678' and '0412'
it('list escapes % and _ in the search text')
it('logInteraction with newContact creates the person, links them to the job and logs the call in one transaction')
it('logInteraction links an existing contact to the job as recruiter if not linked yet')
it('logInteraction defaults kind to call and happenedAt to now, and allows empty notes')
it('emits contact.saved, contact.linked and interaction.logged')
it('listForJob includes relation and the latest interaction time')
it('an unknown job or contact is a 404')
```

- [ ] **Step 2: Run `npx vitest run server/modules/contacts`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Phone search uses `phone_digits LIKE '%' || ? || '%'`, binding digits only.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 12: Search module

**Files:**
- Create: `server/modules/search/{index,service,repo,routes,query}.ts`
- Test: `server/modules/search/query.test.ts`, `server/modules/search/search.test.ts`

**Interfaces:**
- Consumes: `JobsService`, `ContactsService`, `NotesService` (Tasks 8–11), `EventBus`, `queryDigits`.
- Produces:
  - `buildFtsQuery(q: string): string | null`
  - `interface SearchService { query(q: string): SearchHit[]; reindexJob(jobId: number): void; reindexContact(contactId: number): void; rebuild(): RebuildSearchResponse }`
  - `createSearchModule(opts: { db: Db; bus: EventBus; jobs: JobsService; contacts: ContactsService; notes: NotesService; logger: Logger }): HttpModule<SearchService>`
  - Routes: `GET /search?q=`, `POST /search/rebuild`.

- [ ] **Step 1: Write the failing tests:**

```ts
it.each(['C++', 'AT&T', 'node.js', '"senior', '-', '(', '*', '   '])('buildFtsQuery never produces invalid FTS syntax: %s')  // (Review Focus 1)
  // each result is null or runs without error against a real search_index
it('finds a job by the first three letters of the company'); it('…by agency'); it('…by contact name'); it('…by note text'); it('…by ad text')
it('finds a job by part of a contact phone number, and lists phone matches first')
it('lists open jobs before closed ones, then by best match')
it('leaves archived jobs out')
it('returns a contact hit only for a contact with no jobs')
it('stays up to date through events')            // add a note via NotesService → query finds it without calling reindex
it('rebuild restores the index after it is emptied')
it('answers in under 50 ms on 1,000 jobs')        // seed 1,000 jobs + notes; median of 20 'atl' queries < 50 ms
it('snippet marks matches with \\u0001 and \\u0002')
```

- [ ] **Step 2: Run `npx vitest run server/modules/search`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Query building:** split the query into tokens with `q.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)`. Keep at most 8, write each as `"tok"*`, and join them with spaces.
  - **Index rows:**

    | Row | `title` | `people` | `notes` | `ad` |
    |-----|---------|----------|---------|------|
    | job | company, agency, job title | contact names, organisations, emails, phones | notes, interaction notes, location, summary | every posting's `jdText` |
    | contact | contact name | organisation, email, phone | contact notes | — |

  - **Ranking:** `bm25(search_index, 0, 0, 10, 5, 2, 1)`.
    - The sort order is: phone matches first, then open jobs before closed ones, then rank, then `updatedAt` (newest first).
    - Return at most 20 results.
  - **Snippet:** `snippet(search_index, -1, char(1), char(2), '…', 10)`.
  - **Events:** listeners for the Task 4 events call `reindexJob` or `reindexContact`. A failure is logged by the bus.
  - **Arch doc:** update architecture.md §8 (the `SEARCH_INDEX` columns: title, people, notes, ad) and §7.2 (ranking order, archived jobs left out).
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 13: Call sheet view and live events

**Files:**
- Create: `server/modules/callsheet/{index,service,routes}.ts`, `server/modules/live/{index,routes}.ts`
- Test: `server/modules/callsheet/callsheet.test.ts`, `server/modules/live/live.test.ts`

**Interfaces:**
- **Call sheet:** `interface CallsheetService { get(jobId: number): CallSheet }` and `createCallsheetModule(opts: { jobs; contacts; notes }): HttpModule<CallsheetService>`. Route: `GET /jobs/:id/callsheet`. The `documents` part arrives in Phase 4.
- **Live events:** `createLiveModule(opts: { bus: EventBus; heartbeatMs?: number }): HttpModule<{ clientCount(): number }>`. Route: `GET /events` (SSE).
  - It forwards `job.*`, `posting.added`, `note.*`, `contact.*`, `interaction.logged` and `settings.changed` as `event: <name>\ndata: <json>\n\n`.
  - A comment line (`: ping`) goes out every 25 s.

- [ ] **Step 1: Write the failing tests:**

```ts
it('returns job, postings, history, people, notes and interactions, newest first')
it('is a 404 for an unknown job')
it('streams bus events to a connected client')     // real listen on port 0, fetch /api/v1/events, emit job.updated, read the chunk
it('drops the client when the connection closes')  // clientCount() back to 0
```

- [ ] **Step 2: Run `npx vitest run server/modules/callsheet server/modules/live`.** Expected: FAIL.
- [ ] **Step 3: Implement.** SSE uses `reply.hijack()` and writes to `reply.raw` with `content-type: text/event-stream` and `cache-control: no-cache`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.

---

### Task 14: Dashboard shell — search and the job list

**Files:**
- Create:
  - `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/src/main.ts`, `web/src/App.svelte`, `web/src/app.css`
  - `web/src/lib/{api,live.svelte,router.svelte,format,keys}.ts`
  - `web/src/components/{Header,SearchBox,JobList,StatusBadge}.svelte`
  - `web/src/pages/{HomePage,JobPage,SettingsPage}.svelte` (JobPage and SettingsPage are placeholders for Tasks 15 and 17)
  - `playwright.config.ts`, `tests/e2e/{serve,helpers}.ts`
- Modify: `package.json` scripts:
  - `"build": "vite build --config web/vite.config.ts"`
  - `"dev:web": "vite --config web/vite.config.ts"`
  - `"dev:server": "node --watch server/main.ts"`
  - `"typecheck"` adds `&& svelte-check --tsconfig web/tsconfig.json`
  - `"test:e2e": "npm run build && playwright test"`
  - `"check:deps"` adds `web/src` to the folders it checks
- Test: `web/src/lib/format.test.ts`, `tests/e2e/search.spec.ts`
- Install (dev): `svelte vite @sveltejs/vite-plugin-svelte svelte-check @playwright/test`, then run `npx playwright install firefox chromium`

**Interfaces:**
- **Formatting:**
  - `formatDate(localOrIso: string | null): string` → `'28 Oct 2026'`, or `''` for null.
  - `formatRelative(iso: string, now?: Date): string` → `'just now' | '5 min ago' | '3 hours ago' | 'yesterday' | '4 days ago' | formatDate(...)`. Anything 7 days or older uses `formatDate`.
  - `displayTitle(t: string|null) → t ?? 'Untitled role'` and `displayCompany(c: string|null) → c ?? 'Unknown company'`.
- **Keys:** `isTypingTarget(el: Element | null): boolean`. It's true for input, textarea, select and contenteditable.
- **Router:** `router.svelte.ts` exports `route` (a `$state` object `{ name: 'home' | 'job' | 'settings', params }`) and `navigate(path: string): void`. It uses the History API and handles `popstate`.
- **Live events:** `live.svelte.ts` exports `onLive(names: string[], handler: (name, payload) => void): () => void`. It uses one shared `EventSource('/api/v1/events')`.
- **API client:** `api.ts` exports `api = createApiClient({ baseUrl: '' })`.
- **E2E server:** `tests/e2e/serve.ts` starts `buildApp` on a temp root with port **4799**, serving `web/dist`. It adds a test-only `POST /__test/reset`, which empties every table and the search index. It also starts a fixture HTTP server on **4798**: `/job.html` (with JobPosting data), `/plain.html`, and `/blocked` (which returns 403).
- **E2E helpers:** `tests/e2e/helpers.ts` exports these, which call the API with `origin: http://127.0.0.1:4799`:
  - `reset(request)`
  - `seedJob(request, f: { title?: string; company?: string; agency?: string; location?: string; status?: string; jdText?: string }): Promise<Job>`, which sends a `pasted` capture plus `fields`
  - `seedCall(request, jobId, c: { name: string; phone?: string; notes?: string }): Promise<Interaction>`
- **Playwright config:** `use.baseURL: 'http://127.0.0.1:4799'`, `workers: 1`, projects `firefox` and `chromium`. `webServer: { command: 'node tests/e2e/serve.ts', url: 'http://127.0.0.1:4799/api/v1/health', reuseExistingServer: false }`. Each spec calls `reset` in `beforeEach`.

**UI decisions:**
- **Header:** "Job Registry", the search box, the "+ New job" button (Task 16) and a "Settings" link.
- **Search box:**
  - Placeholder: `Search company, role, person or phone`. It's focused when the page loads.
  - `/` or `Ctrl+K` focuses it from anywhere, except when typing in another field (`Ctrl+K` works even then).
  - Requests go out 80 ms after the last keystroke, and older ones are aborted.
  - Results replace the job list. The first result is highlighted. `↑`/`↓` move, `Enter` opens and `Esc` clears.
  - Empty results show `No jobs match "{q}".`
  - Snippets show `\u0001…\u0002` as `<mark>`, from escaped text.
- **Job list:**
  - Columns: Company (with the agency in grey) · Role · Status · Applied · Updated (relative).
  - Filter chips: **Open** (default) · **Closed** · **All**, plus a "Status" select listing every status.
  - The sort select offers: Recently updated · Date applied · Company A–Z.
  - When there are no jobs at all, it shows: `No jobs yet. Press N or paste a job ad to add one.`
  - Blank titles and companies use `displayTitle`/`displayCompany`.
  - The list reloads 300 ms after any `job.*` live event.
- **Styling:** `app.css` holds CSS variables, the system font stack, light and dark through `prefers-color-scheme`, and status badges. Closed statuses are grey, and open ones use the accent colour.
- **Dev proxy:** `web/vite.config.ts` proxies `/api` to `http://127.0.0.1:4777` with `changeOrigin: true` and `headers: { origin: 'http://127.0.0.1:4777' }`. The output folder is `web/dist`.

- [ ] **Step 1: Write the failing tests:**

```ts
// format.test.ts
formatDate('2026-10-28') === '28 Oct 2026'; formatDate('2026-01-05T03:00:00Z') === '5 Jan 2026'; formatDate(null) === ''
formatRelative cases for each band; displayTitle(null) === 'Untitled role'; displayCompany(null) === 'Unknown company'
// search.spec.ts (beforeEach reset)
test('search is focused on load and finds a job by three letters of the company in under 2 seconds')
  // seed Atlassian; type 'atl'; expect first result to contain 'Atlassian' within 2000 ms; Enter → URL /jobs/{id}
test('finds a job by part of a contact phone number')          // seedCall phone '+61 412 345 678'; type '345 678'
test('/ and Ctrl+K focus the search box; Esc clears it and shows the list')
test('status chips filter the list')                           // applied job vs rejected job across Open / Closed / All
test('a job with no title or company shows placeholders')      // (Review Focus 4) row shows 'Untitled role' and 'Unknown company'
```

- [ ] **Step 2: Run `npx vitest run web && npm run test:e2e -- search.spec.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run `npm test && npm run test:e2e -- search.spec.ts`.** Expected: PASS in Firefox and Chromium.

---

### Task 15: Job page — call sheet, status, edit, notes, people, call log, timeline

**Files:**
- Create: `web/src/components/{CallSheet,StatusPicker,PeopleList,LogCallDialog,NotesPanel,Timeline,AdText,EditJobDialog}.svelte`, `web/src/lib/timeline.ts`
- Modify: `web/src/pages/JobPage.svelte`
- Test: `web/src/lib/timeline.test.ts`, `tests/e2e/job.spec.ts`

**Interfaces:**
- `buildTimeline(cs: CallSheet): TimelineItem[]`, where `type TimelineItem = { at: string; kind: 'status' | 'note' | 'call' | 'ad'; text: string }`, newest first.
  - Status text: `Saved → Applied`, or `Saved` for the first change.
  - Call text: `{Kind} with {contactName or 'someone'}: {notes}`.
  - Ad text: `Ad saved from {Site}`.

**UI decisions:**
- **Call sheet card** (top of the page; everything here fits one screen at 1366×768):
  - title (large), company · agency, status badge, applied date
  - salary text (or min–max), location · work mode · employment type, closing date
  - requirements (first 6, and only if any exist)
  - people
  - the 3 latest notes.
- **Shortcuts on this page:**
  - `S`: change status (a select of every status, in order)
  - `L`: log call
  - `E`: edit fields
  - `Esc`: back to the list, unless a dialog is open
  - A "More" menu holds **Archive**, which sets `archived: true` and returns to the list.
- **Log call dialog** (a native `<dialog>`):
  - **Person:** a box that suggests this job's people first, then `GET /contacts?q=`. The last option is `New person: {typed name}`, which reveals Phone, Email, Role and Organisation fields.
  - **Kind:** Call by default.
  - **Notes.** `Ctrl+Enter` saves.
  - One `POST /interactions` with `jobId`.
- **Notes panel:** a textarea, saved with `Ctrl+Enter`. The new note appears at the top.
- **Below the card:**
  - the timeline
  - "Saved ad": one block per posting, showing site, captured date, a link to the source URL, and `jdText` with line breaks kept, collapsed after 12 lines.
- **Live updates:** the page reloads the call sheet when a live event's `jobId` is this job's.
- **Placeholders:** a blank title or company uses `displayTitle`/`displayCompany` here as well.

- [ ] **Step 1: Write the failing tests:**

```ts
// timeline.test.ts
it('merges status changes, notes, calls and ads newest first with the agreed text')
// job.spec.ts
test('shows the call sheet for a job')                        // company, title, status, applied date, location, salary text
test('changes status with S and shows it in the timeline')    // 'Applied → Interview 1'
test('moving to Applied sets the applied date to today')      // shows formatDate(today)
test('logs a call with a new person')                         // L, 'Priya Shah', New person, phone, notes, Ctrl+Enter → in People and timeline
test('adds a note with Ctrl+Enter'); test('edits fields with E and keeps them after reload')
test('shows the saved ad text with its line breaks')
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test && npm run test:e2e -- job.spec.ts`.** Expected: PASS.

---

### Task 16: New job — paste, preview, "Same job?"

**Files:**
- Create: `web/src/components/{NewJobDialog,SamePrompt}.svelte`, `tests/e2e/fixtures/{job,plain}.html`
- Modify: `web/src/App.svelte` (`N` key, the paste listener), `web/src/components/Header.svelte`
- Test: `tests/e2e/new-job.spec.ts`

**UI decisions:**
- **Opening:** the "+ New job" button, `N`, or a `paste` event on `document` while the focus isn't in a field. The paste reads `event.clipboardData.getData('text')` and fills the box.
- **Step 1 of the dialog:**
  - A textarea labelled `Paste a job link or the ad text`.
  - If the text is a single line starting with `http`, the app calls `previewCapture({ url })`. Otherwise it calls `previewCapture({ text })`.
  - Any `warning` shows above the form.
- **Step 2 of the dialog:**
  - The form has Title, Company, Agency, Location (prefilled from `capture.structured` or the capture), Status (default Saved) and an optional Note. The ad text is shown collapsed.
  - **Save** is disabled while a request is in flight. It sends `saveJob({ capture, fields, status })`. Fields the user changed go in `fields`.
- **On a `needs_decision` reply**, `SamePrompt` lists each candidate as:

  `Looks like {title} at {company} ({sites joined with ', '}, {status label} {formatDate(dateApplied)}).`

  It has two buttons, **Same job** and **Different job**. These resend the save with `{ linkTo }` or `'new'`.
- **After saving:** if there's a note, the app calls `addNote`, then navigates to `/jobs/{id}`.
  - `exists` goes to the existing job, with the toast `You've already saved this job.`
  - `linked` shows the toast `Added this ad to the existing job.`

- [ ] **Step 1: Write the failing tests:**

```ts
test('saves pasted ad text as a new job')                      // N, paste text, title+company, status Applied → job page, Applied today
test('a pasted link fills the form from JobPosting data')       // http://127.0.0.1:4798/job.html
test('a blocked link shows the warning')                        // /blocked → "That site didn't let the app download this page. Copy the ad text from your browser and paste it here instead."
test('asks "Same job?" for a likely duplicate, and Same job links the ad') // seeded 'Senior Engineer' at 'Atlassian'; new 'Atlassian Pty Ltd' → 2 ads on the job page
test('Different job creates a second job')
test('pasting outside a field opens the dialog with the text')  // dispatch ClipboardEvent('paste') with DataTransfer
test('double-clicking Save creates only one job')
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test && npm run test:e2e -- new-job.spec.ts`.** Expected: PASS.

---

### Task 17: Settings page — statuses, backup, search index

**Files:**
- Create: `web/src/lib/statuses.ts`
- Modify: `web/src/pages/SettingsPage.svelte`
- Test: `web/src/lib/statuses.test.ts`, `tests/e2e/settings.spec.ts`

**Interfaces:**
- `slugifyStatusId(label: string, existing: string[]): string`
  - `'Phone screen'` → `'phone_screen'`
  - If that id exists, it becomes `'phone_screen_2'`
  - `'  Offer!! '` → `'offer'` (or `'offer_2'` if `offer` exists)
- `moveStatus(list: Status[], id: string, dir: -1 | 1): Status[]`, which renumbers `order` as 10, 20, 30, and so on.

**UI decisions:**
- **Statuses table:**
  - Each row has its label (editable), **Closed** and **Sets applied date** checkboxes, and ↑ and ↓ buttons.
  - **Add status** adds a row with the id slugified from its label. The id is fixed once saved and shown in small grey text.
  - **Save** calls `updateSettings({ statuses })`. Server validation messages appear in place.
  - There's no delete in Phase 1.
- **Data section:**
  - **Back up now** shows `Backed up to {file}`.
  - **Rebuild search index** shows `Search index rebuilt: {jobs} jobs, {contacts} contacts.`
  - It also shows the data folder path, from the backup response folder.

- [ ] **Step 1: Write the failing tests:**

```ts
it('slugifies labels and avoids existing ids'); it('moveStatus renumbers order')
test('renames a status and the list shows the new label')
test('adds a status and it appears in the status picker')
test('Back up now shows the backup file name')
```

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test && npm run test:e2e -- settings.spec.ts`.** Expected: PASS.

---

### Task 18: Windows scripts, example settings, README and docs

**Files:**
- Create: `setup.bat`, `scripts/setup.ps1`, `start.bat`, `stop.bat`, `start.sh`, `scripts/port.mjs`, `config/settings.example.json`, `README.md`, `docs/checklists/phase-1-windows.md`
- Modify: `CLAUDE.md` (the commands and the current status)
- Test: `tests/settings-example.test.ts`

**Script behaviour** (exact copy in quotes):
- **`scripts/port.mjs`:** prints `settings.server.port` from `config/settings.json`. If the file is missing, it prints `4777`.
- **`setup.bat`:** `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"`, then `pause`.
- **`setup.ps1`:**
  1. Check that `node -v` is version 24 or above. If not, print `Job Registry needs Node.js 24 or later. Install it with: winget install OpenJS.NodeJS.LTS — then run setup.bat again.` and exit 1.
  2. Run `npm ci`, then `npm run build`.
  3. Create `data\`, `data\backups\`, `data\logs\` and `data\files\`. Copy `config\settings.example.json` to `config\settings.json` if it's missing.
  4. Ask `Create a Desktop shortcut? (Y/n)`. On yes, create a WScript.Shell shortcut `Job Registry.lnk` pointing to `start.bat`, with the working directory set to the app folder.
  5. Ask `Start Job Registry when you log in? (y/N)`. On yes, create a Startup-folder shortcut to `start.bat --no-browser` with `WindowStyle = 7` (minimised).
  6. Print `All set. Double-click start.bat or the Desktop shortcut.`
- **`start.bat`:**
  1. `cd /d "%~dp0"`, then read the port with `for /f %%p in ('node scripts\port.mjs') do set PORT=%%p`.
  2. Check `http://127.0.0.1:%PORT%/api/v1/health` with PowerShell `Invoke-RestMethod -TimeoutSec 2`. If it's healthy, skip to step 4.
  3. Run `start "Job Registry server - close this window to stop" /min node server\main.ts`. Poll health every 500 ms, for up to 20 s. If it never comes up, print `The server didn't start. See data\logs for details.` and pause.
  4. Unless `%1` is `--no-browser`, run `start "" http://127.0.0.1:%PORT%/`.
- **`stop.bat`:** `POST /api/v1/system/shutdown` through `Invoke-RestMethod` with the header `Origin = http://127.0.0.1:%PORT%`. Then print `Job Registry stopped.`, or `Job Registry wasn't running.` on error.
- **`start.sh`** (macOS and development): starts `node server/main.ts` in the background, waits for health, then runs `open` on the URL.

**Docs:**
- **`README.md`**, written for you. It covers:
  - what the app does
  - first-time setup on Windows: install Node LTS, then run `setup.bat`
  - daily use: `start.bat`, and the keys `/` `N` `L` `S` `E`
  - where data lives, and backups
  - how to stop the app.
- **`docs/checklists/phase-1-windows.md`**, a manual checklist:
  - `setup.bat` succeeds
  - `start.bat` opens the dashboard
  - running `start.bat` again doesn't start a second server
  - `stop.bat` stops it
  - the Desktop shortcut works
  - the login start works, with no browser
  - add a job, log a call with a phone number, close the browser, and find the job again by typing part of the number in under 2 seconds.
- **`CLAUDE.md`:**
  - Add a "Commands" section with `npm test`, `npm run test:e2e`, `npm run dev:server` + `npm run dev:web`, `npm run build` and `npm start`.
  - Set the status to "Phase 1 built, waiting for the Windows checklist".

- [ ] **Step 1: Write the failing test.** `it('settings.example.json matches DEFAULT_SETTINGS')`: the parsed file deep-equals `DEFAULT_SETTINGS`.
- [ ] **Step 2: Run `npx vitest run tests/settings-example.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Write the scripts and docs above.** Generate `settings.example.json` once from `JSON.stringify(DEFAULT_SETTINGS, null, 2)`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Run `./start.sh` on macOS.** Expected: the dashboard opens in the browser.
- [ ] **Step 6: Run `node -e "fetch('http://127.0.0.1:4777/api/v1/health').then(r=>r.json()).then(console.log)"`.** Expected: it prints `{ ok: true, … }`.

---

### Task 19: Phase 1 verification

**Files:** none new.

- [ ] **Step 1: Run `npm test`.** Expected: typecheck clean, `check:deps` reports 0 violations, and every Vitest test passes, including the 50 ms search test.
- [ ] **Step 2: Run `npm run test:e2e`.** Expected: every spec passes in both Firefox and Chromium.
- [ ] **Step 3: Check that the architecture check bites.** Temporarily add `import '../jobs/repo.ts'` to `server/modules/search/service.ts`, run `npm run check:deps` and expect a `module-private` failure. Then remove the import.
- [ ] **Step 4: Do a manual smoke test on macOS with `./start.sh`.**
  1. Paste a real Seek ad as text.
  2. Log a call with a phone number.
  3. Reload the page.
  4. Type part of the number.

  Expected: the job is first in the results, in well under 2 seconds.
- [ ] **Step 5: Hand-over.** List anything that couldn't be checked on macOS: the `.bat` and `.ps1` scripts and the shortcuts. Point the user to `docs/checklists/phase-1-windows.md`.
