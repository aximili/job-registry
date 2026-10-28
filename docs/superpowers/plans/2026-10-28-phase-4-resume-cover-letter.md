# Phase 4 — Resume and Cover Letter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For any saved job, generate a tailored resume and cover letter from your master profile. The text streams into an editor, with the text on the left and a live A4 preview on the right, plus light fact-check highlights. Save as many versions as you like. Mark one as sent, which freezes it with the template CSS as it was then. Print it to PDF, or export a .docx. Attach files you made elsewhere. Edit your profile, guides and templates in Settings.

**Architecture:** architecture §4 (`documents`, `profile`), §5, §6.4 (`DocumentExporter`), §7.4, §8 (`DOCUMENTS`, `ATTACHMENTS`), §9, §10, §12.1 (`writeDocument`: thinking on, streamed), §13.
- The `documents` module is composite (it calls `ai`, `profile` and `jobs`). It owns the `documents` and `attachments` tables and `data/files/`.
- `shared/markdown.ts` (marked, raw HTML escaped) and `shared/document-page.ts` (the A4 page shell) render the same way in the browser preview, the print view and the .docx export.
- `shared/fact-check.ts` runs in the browser as you type.
- The call sheet shows the sent resume and cover letter.

**Tech stack:** as before, plus `marked` 18 (shared), `docx` 9 (server) and `@fastify/multipart` 10 (attachments).

**Spec:** docs/plan.md ("Resume and cover letter"; Phase 4 is done when "two jobs each have their own sent resume, and changing `resume.css` afterwards doesn't change how either sent version looks"), docs/architecture.md (sections above), and the "Notes for Phase 4" in CLAUDE.md.

**Ledger:** `.superpowers/sdd/2026-10-28-phase-4-resume-cover-letter/progress.md`. No git writes (the user's rule): each task ends with its test command and result in the ledger.

## Global Constraints

- Everything in the earlier plans' Global Constraints still holds. That covers plain English and Australian spelling, erasable TypeScript, `check:deps` passing without weakening a rule, and Windows scripts in ASCII with CRLF.
- **Documents are append-only.** Every **Save version** inserts a row. The repo has no UPDATE of `markdown`. The only update is `markSent`, which sets `is_sent`, `sent_at` and `sent_css` once.
- **Mark as sent** stores `sent_css` (the template's text at that moment) and `sent_at`. Rendering a sent version always uses `sent_css`, never the current template.
- **The AI never invents experience.** The prompts say: use only facts from the master profile, never invent employers, titles, dates, numbers or certifications, follow the guide, and use Australian spelling.
- **The fact-check never blocks saving or sending.**
- **Thinking** is on for documents (`reasoning_effort: "medium"`). Thinking text never goes into a document.
- **Markdown** goes through `shared/markdown.ts`:
  - Raw HTML is escaped as text.
  - Links other than `http:`, `https:` and `mailto:` become plain text.
  - Images show as their alt text.
- **The page shell** (`documentPage`) carries `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">`.
  - The print view also sends that policy as a header.
  - The dashboard preview is an iframe with `sandbox=""`, so no scripts run in it.
- **Profile files** live in `profile/` and templates in `templates/`. Both folders are git-ignored.
  - Starters are tracked in `starters/profile/` and `starters/templates/`. They are copied in at server start only when a file is missing.
  - Starters exist only for the guides and the templates. A starter master profile or preferences file would be rated as if it were yours.
  - Writes to profile and template files are `dashboardOnly`.
- **Attachments** go in `data/files/<jobId>/<8 hex>-<clean name>`. The path is stored relative to `data/files/`.
  - Limits: 15 MB, and only `.pdf .docx .doc .rtf .txt .odt` files.
  - Downloads use `Content-Disposition: attachment`.
- **Backups** also copy `data/files/` to `<backupDir>/files/`. New and changed files are copied, and nothing is deleted.
- **Migration** `003_documents.sql`, with a test. Never edit 001 or 002.
- Copy (exact):
  - sent document edited: "This version was sent, so it can't be changed. Save a new version instead."
  - no profile: "Add your master profile first: Settings → Profile."
  - empty document: "A document can't be empty."
  - too big: "That file is over 15 MB."
  - wrong type: "Attach a PDF, Word or text file."

## Review Focus

1. **A sent document stays exactly as sent.** Editing `resume.css` after sending changes none of these for the sent version: the preview, the print view or the .docx. A save never touches a sent row. → Tasks 3, 4, 10
2. **The AI adds things that aren't in the profile.** A new employer name, a made-up percentage or a certification shows in "Not in your profile: …" and is highlighted in the preview. Profile facts written differently aren't flagged. Neither are headings like "Professional Summary", nor a capitalised word that simply starts a sentence. → Tasks 1, 10
3. **Markdown with HTML or scripts in it** (pasted, or from the AI) shows as text. It never runs and never loads anything, in the preview, the print view or the .docx. Template CSS containing `</style>` can't break out of the page. → Tasks 1, 4
4. **Generation stops part-way:** you press Stop, the AI fails, or you close the tab. What arrived stays in the editor, unsaved but not lost. Nothing is saved by itself, and thinking text never appears. → Tasks 5, 10
5. **A strange attachment** (16 MB, `..\..\evil.exe`, a name with emoji, slashes or `CON`) gets a clear refusal or a cleaned name. Nothing is ever written outside `data/files/<jobId>/`. → Task 6

---

### Task 1: Shared Markdown, the page shell, and the fact-check

**Files:**
- Create: `shared/markdown.ts`, `shared/document-page.ts`, `shared/fact-check.ts`, with a `.test.ts` next to each.
- Modify: `package.json` (dependency `marked@^18`). `.dependency-cruiser.cjs` already allows `marked` in `shared/`.

**Interfaces (produces):**
- `renderMarkdown(md: string, opts?: { highlight?: string[] }): string`: GFM, `breaks: true`. `highlight` wraps each case-insensitive occurrence of each string in `<mark>`, in text only and never inside a tag.
- `lexMarkdown(md: string): Token[]`: marked's tokens, with the same options (for the .docx export).
- `documentPage(o: { title: string; markdown: string; css: string; highlight?: string[] }): string`:
  - A full HTML page: `<!doctype html>`, the CSP meta, `<title>`, `<style>` with the CSS (every `</style` becomes `<\/style`), and `<body><article class="document">…</article></body>`.
  - The `<title>` is escaped.
- `type FactKind = 'number' | 'percent' | 'money' | 'year' | 'range' | 'name'`, `type Flag = { text: string; kind: FactKind }`.
- `createFactChecker(profile: string, allow?: string[]): (draft: string) => Flag[]`, plus `factCheck(draft, profile, allow?)`. The profile is normalised once. Flags are unique by normalised text, in order of first appearance.

**The fact-check rules** (the parts the tests don't pin down):
- Markdown syntax (`#`, `*`, `_`, list markers like `1.` and `-`) is ignored. Link targets are skipped.
- **Numbers.** A token is money (`$120k`, `$1.2m`, `$150,000`), a percent (`30%`, `30 %`), a range (`2019–2021`, `Jan 2020 – Mar 2022`, `2019 - Present`), a year (`19xx`/`20xx`) or a number.
  - A phone-like run (8 or more digits, with spaces, brackets, `+` or `-`) is one number, compared by its digits only.
- **Normalising** applies to both sides:
  - lower case
  - every dash (`– — ‑`) becomes `-`, and spaces around `-` and before `%` are dropped
  - commas inside numbers are dropped
  - runs of whitespace become one space.
- A number is found only when it isn't part of a longer number in the profile, so "5" doesn't match "2015".
- **Names** are runs of capitalised words, or words with a digit or an inner capital (`AWS`, `PowerBI`, `ISO27001`). Hyphens and `&` may join words, and a possessive `'s` is dropped.
  - Common words split a run and never count. These include resume headings, letter words, and month and day names:
    - `I`, `Dear`, `Hiring`, `Manager`, `Team`, `Sincerely`, `Regards`, `Kind`, `Yours`, `Re`
    - `Summary`, `Professional`, `Profile`, `Experience`, `Work`, `Employment`, `History`, `Skills`, `Key`, `Core`, `Technical`, `Education`, `Certifications`, `Projects`, `Achievements`, `Career`, `References`, `Available`, `Upon`, `Request`, `Contact`, `Phone`, `Mobile`, `Email`, `Present`, `Current`
    - Australian states and territories: `NSW`, `VIC`, `QLD`, `WA`, `SA`, `TAS`, `ACT`, `NT`.
  - A run passes when its normalised text appears in the profile.
  - If it doesn't, and the run starts a sentence or a line, its first word is dropped and the rest is checked. An acronym, or a word with a digit or an inner capital, isn't dropped. If nothing is left, nothing is flagged.
- `allow` (the job's title, company and agency) adds text that is never flagged.

- [ ] **Step 1: Write the failing tests**
  - `markdown.test.ts`:
    - `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>` and `<iframe src=//evil>` render with no `<script`, `<img` or `<iframe` tag, and the text shows escaped.
    - `[x](javascript:alert(1))` renders as text, with no `href`.
    - `![logo](http://evil/x.png)` renders `logo` and no `<img`.
    - `[me](https://example.com)` and `[mail](mailto:a@b.co)` keep their links.
    - With `highlight: ['40%']`, `Grew sales by 40%` gives `<mark>40%</mark>`. A highlight never changes a tag: a highlight of `p` leaves `<p>` alone.
  - `document-page.test.ts`:
    - The page has the CSP meta.
    - CSS `body{} </style><script>x</script>` doesn't end the style element. The page has exactly one `</style>` and no `<script`.
    - The title `<b>` is escaped.
  - `fact-check.test.ts`, with a profile that has "Example Co", "2019-2021", "30%", "$150,000", "0412 345 678", "TypeScript" and "AWS Certified Developer":
    - Flagged: `Grew revenue 40%` → `{ text: '40%', kind: 'percent' }`; `Worked at Globex` → `Globex`; `AWS Certified Solutions Architect` at a bullet's start → that whole text; `$200k` → money; `2016–2018` → range.
    - Not flagged: `30 %`, `2019–2021`, `$150,000`, `0412345678`, `typescript` and `Example Co's platform`.
    - Not flagged, because they're headings or sentence starts: `## Professional Summary` and `Led the TypeScript move`.
    - Not flagged when `allow` has them: `Dear Hiring Manager, I'd love to join Atlassian as a Senior Engineer`, with `allow: ['Atlassian', 'Senior Engineer']`.
    - `5 years` with a profile that only has "2015" → flagged.
    - The same invented name twice gives one flag.
- [ ] **Step 2: Run** `npx vitest run shared/markdown.test.ts shared/document-page.test.ts shared/fact-check.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** `npm install marked@^18`. Use marked's renderer overrides for `html`, `link` and `image`. Escape with one helper. Highlighting runs over the rendered HTML's text segments, outside `<…>`, matching the HTML-escaped form of each string.
- [ ] **Step 4: Run** the same command, then `npm run check:deps`. Expected: PASS, and no rule broken.

---

### Task 2: Profile files — names, read and write, starters, routes

**Files:**
- Modify: `server/modules/profile/{service,index}.ts`, `server/modules/profile/profile.test.ts`, `server/core/events.ts` (`'profile.changed': { name: ProfileFileName }`), `server/modules/live/index.ts` (forward `profile.`), `server/app.ts`, `.gitignore` (`/templates/`), `tests/gitignore.test.ts`.
- Create: `server/modules/profile/routes.ts`, `shared/contracts/profile.ts` (exported from the index), `starters/profile/{resume-guide,cover-letter-guide}.md`, `starters/templates/{resume,cover-letter}.css`.

**Interfaces (produces):**
- `ProfileFileName = z.enum(['master-profile','preferences','resume-guide','cover-letter-guide','resume','cover-letter'])`. The `.md` files live in `profile/`, and the `.css` files (`resume`, `cover-letter`) in `templates/`.
- `ProfileFile = { name, text: string, updatedAt: IsoDateTime | null }`. `text` is `''` and `updatedAt` is null for a missing file.
- `PutProfileRequest = z.strictObject({ text: z.string().max(200_000) })`.
- `ProfileService`:
  - keeps `read(name)` (null when missing or blank) and `hash()` (still only the master profile and preferences)
  - adds `file(name): ProfileFile`
  - adds `write(name, text): ProfileFile`: a temporary file, then `replaceFile`, then `profile.changed`
  - adds `installStarters(): string[]`: the names copied, only for missing files, never overwriting.
- `createProfileModule({ dir, templatesDir, startersDir, bus, now })`. app.ts passes `startersDir = fileURLToPath(new URL('../starters/', import.meta.url))` and calls `installStarters()` once at build.
- Routes:
  - `GET /profile/:name` returns a `ProfileFile`. An unknown name is a 404: "There's no profile file called x."
  - `PUT /profile/:name` takes `{ text }` and is `dashboardOnly("Only the dashboard can change your profile and templates.")`.

**Starters:**
- **The guides:** short advice in plain English.
  - Resume: two pages at most, newest job first, results with numbers you can back up, skills grouped.
  - Cover letter: under one page, three or four short paragraphs, why this role, two matching achievements, close.
- **`resume.css`:** A4 with `@page { size: A4; margin: 16mm 18mm; }`, a system sans-serif at 10.5pt, `h1` for the name, `h2` with a rule under it, tight lists, and `@media screen` showing a white A4 sheet on grey.
- **`cover-letter.css`:** the same look at 11pt, with more line spacing.

- [ ] **Step 1: Write the failing tests** (`profile.test.ts`, plus API tests through `createTestApp`):
  - Write then read each of the six names. `.css` files land in `templates/` and `.md` files in `profile/`.
  - `write` emits `profile.changed` with the name.
  - An unknown name is a 404.
  - A PUT with `origin: moz-extension://x` is a 403 with the dashboard-only message.
  - `installStarters` copies the four starters into empty folders, returns their names, and leaves an existing `resume.css` alone. It never creates `master-profile.md` or `preferences.md`.
  - The hash changes for the master profile, but not for `resume.css`.
  - gitignore: `templates/resume.css` is ignored, and `starters/templates/resume.css` is not.
- [ ] **Step 2: Run** `npx vitest run server/modules/profile tests/gitignore.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, as above.
- [ ] **Step 4: Run** the same command, then `npm test`. Expected: PASS.

---

### Task 3: Migration 003, documents repo, service and routes (versions, sent, copy)

**Files:**
- Create:
  - `server/core/db/migrations/003_documents.sql`
  - `server/modules/documents/{index,service,repo,routes}.ts` and `documents.test.ts`
  - `shared/contracts/documents.ts` (exported from the index)
- Modify: `server/core/db/db.test.ts` (`LATEST = 3`, plus an upgrade test), `server/core/events.ts`, `server/modules/live/index.ts` (forward `document.` and `attachment.`), `server/app.ts`.

**Migration:** the SQL from architecture §8:
- `documents` has `UNIQUE (job_id, kind, version)` and `CHECK (kind IN ('resume','cover_letter'))`.
- `attachments` has `CHECK (kind IN ('resume','cover_letter','other'))`.
- Both have `REFERENCES jobs(id)` and an index on `job_id`.

**Interfaces (produces):**
- Contracts:
  - `DocumentKind = z.enum(['resume','cover_letter'])`
  - `DocumentOrigin = z.enum(['generated','edited','copied'])`
  - `DocumentSummary = { id, jobId, kind, version, origin, copiedFromId: Id | null, isSent: boolean, sentAt: IsoDateTime | null, createdAt }`
  - `Document = DocumentSummary & { markdown: string; sentCss: string | null }`
  - `DocumentListItem = DocumentSummary & { jobTitle: string | null; company: string | null }`
  - `SaveDocumentRequest = union(strictObject({ kind, markdown: string.max(100_000), origin: enum(['generated','edited']).default('edited') }), strictObject({ fromDocumentId: Id }))`
  - `SentDocuments = { resume: DocumentSummary | null; coverLetter: DocumentSummary | null }`
- Events: `'document.saved': { jobId, documentId }`, `'document.sent': { jobId, documentId }`, `'attachment.added': { jobId, attachmentId }`.
- `DocumentsService` (this task's part):
  - `list(jobId): DocumentSummary[]`: newest first, both kinds.
  - `listAll(kind?: DocumentKind): DocumentListItem[]`: across jobs, newest first. Job names come from `jobs.getSummaries`.
  - `get(id): Document`: a 404 is "Document 9 not found".
  - `saveVersion(jobId, { kind, markdown, origin }): Document`:
    - It checks that the job exists (`jobs.get`).
    - It trims trailing whitespace only. Empty text is the empty-document error.
    - The next version is per job and kind, in one transaction.
  - `copyFrom(jobId, sourceId): Document`: a new version of the source's kind on `jobId`, with origin `copied` and `copiedFromId` set. Works across jobs.
  - `markSent(id): Document`:
    - It reads `profile.read('resume' | 'cover-letter')` (empty string when missing).
    - It sets `is_sent = 1`, `sent_at` and `sent_css` only `WHERE is_sent = 0`, so a second call changes nothing.
    - Other sent versions stay sent.
  - `latestSent(jobId): SentDocuments`.
- `createDocumentsModule({ db, bus, now, ai, profile, jobs, filesDir, exporters })`. This task passes `exporters: []`, and Task 4 fills it in.
- Routes:
  - `GET /jobs/:id/documents` and `POST /jobs/:id/documents` (201)
  - `GET /documents?kind=`
  - `GET /documents/:id`
  - `POST /documents/:id/sent`

- [ ] **Step 1: Write the failing tests:**
  - `documents.test.ts`:
    - Versions count 1, 2 for a resume and 1 for a cover letter on the same job.
    - `saveVersion` on job 999 is a 404.
    - Empty text gets the copy.
    - `markSent` freezes the CSS. Writing a new `resume.css` afterwards leaves `sentCss` unchanged, and a second `markSent` keeps the first `sentAt`.
    - `copyFrom` copies across jobs, with `origin: 'copied'`.
    - `latestSent` returns the newest sent per kind.
    - Events are `document.saved` and `document.sent`.
    - The API's POST and GET round-trip. A `fromDocumentId` body copies.
    - `GET /documents?kind=resume` lists resumes across jobs, with each job's title and company.
  - Repo: there is no update of `markdown` at all. A test calls `markSent` on a sent row twice and compares the rows. A grep test asserts that `repo.ts` contains no `UPDATE documents SET markdown`.
  - `db.test.ts`: `LATEST = 3`, and a version 2 database with a job is upgraded and keeps the job.
- [ ] **Step 2: Run** `npx vitest run server/modules/documents server/core/db`. Expected: FAIL.
- [ ] **Step 3: Implement.** SQL stays in `repo.ts` and the logic in `service.ts`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, with `check:deps` clean.

---

### Task 4: The print view and exporters

**Files:**
- Create: `server/modules/documents/exporters/{print-html,docx}.ts`, `server/modules/documents/exporters/exporters.test.ts`, `tests/helpers/unzip.ts` (a tiny zip reader on `zlib.inflateRawSync`).
- Modify:
  - `server/modules/documents/{service,routes,index}.ts`
  - `server/app.ts` (wires `[createPrintHtmlExporter(), createDocxExporter()]`)
  - `.dependency-cruiser.cjs`: `adapters-only-from-index` gains `exporters`, which makes the rule stronger
  - `package.json` (`docx@^9`)

**Interfaces (produces):**
- `DocumentExporter` (§6.4), in `server/modules/documents/exporter.ts`:

  ```ts
  { id: string; label: string;
    export(doc: { title: string; markdown: string; css: string }): Promise<{ contentType: string; fileName: string; body: Buffer | string }> }
  ```
- `ExporterInfo = { id: string; label: string }` (contract).
- Service:
  - `render(id): { title: string; html: string }`: `documentPage` with `sent_css` for a sent version, otherwise the current template.
  - `exporters(): ExporterInfo[]`
  - `export(id, format): Promise<{ contentType; fileName; body }>`: an unknown format is a 400: "There's no export called x."
- **The title** is `{name} – Resume – {company}` or `{name} – Cover letter – {company}`.
  - `name` is the master profile's first `# ` heading, or "Resume" or "Cover letter" alone when there is none.
  - `company` is left out when it's unknown.
  - The file name is the title cleaned for Windows (no `\/:*?"<>|`), plus `.docx` or `.html`.
- **The exporters:**
  - `PrintHtmlExporter`: id `print-html`, label "Save as HTML", the `documentPage` itself.
  - `DocxExporter`: id `docx`, label "Export .docx".
    - It walks `lexMarkdown` tokens into paragraphs, headings 1–3, bullet and numbered lists, bold, italic and external links.
    - Raw HTML becomes plain text.
    - The font is Calibri 11, and the page is A4 (11906 × 16838 twips).
- Routes:
  - `GET /documents/:id/render` sends `text/html; charset=utf-8` with the CSP header (Global Constraints).
  - `GET /documents/:id/export?format=` sends `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<encoded>`.
  - `GET /documents/exporters`.

- [ ] **Step 1: Write the failing tests:**
  - Render a sent resume, write a new `resume.css` with `h1{color:red}`, then render again. The page still has the old CSS and no `color:red`. This is the done criterion at API level, for two jobs.
  - Render has the CSP header and escapes `<script>` from the Markdown.
  - The docx export is a zip whose `word/document.xml` contains the heading text, a bullet's text, `Calibri` and `w:w="11906"`. A `<script>` in the Markdown appears only as escaped text.
  - An unknown format is a 400.
  - `GET /documents/exporters` lists `print-html` and `docx`.
  - A planted import of `exporters/docx.ts` from `service.ts` fails `check:deps` (same pattern as `tests/architecture/deps.test.ts`).
- [ ] **Step 2: Run** `npx vitest run server/modules/documents tests/architecture`. Expected: FAIL.
- [ ] **Step 3: Implement.** `npm install docx@^9`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

---

### Task 5: AI `writeDocument` (streamed) and generate

**Files:**
- Create: `server/modules/ai/tasks/write-document.ts`, `server/modules/ai/prompts/{write-resume,write-cover-letter}.md`, `server/modules/ai/write.test.ts`.
- Modify:
  - `server/modules/ai/service.ts`
  - `shared/contracts/ai.ts` (`tasks.write`: temperature 0.6, maxTokens 8192, thinking true, effort medium)
  - `config/settings.example.json`
  - `server/modules/documents/{service,routes}.ts`
  - `shared/contracts/documents.ts`
  - `shared/api-client.ts` and its test
  - `tests/fakes/fake-ai-provider.ts` (`thinking`, `chunkDelayMs`)
  - `tests/fakes/smart-fake-ai.ts` (a canned resume and cover letter)

**Interfaces (produces):**
- `WriteInput = { kind: 'resume' | 'cover_letter'; profile: string; guide: string | null; job: string; ad: string; today: string }`. `job` is a plain-text block of the job's fields, formatted by `documents`, so `ai` never sees a `Job`.
- `AiService.writeDocument(input, opts?: { signal?: AbortSignal; key?: string }): AsyncIterable<string>`:
  - It runs through the queue at `interactive` priority and holds the GPU until the stream ends, is aborted, or the consumer stops early.
  - It yields only `text` chunks.
  - Errors are thrown from the iterator.
- **The prompts** put the system part first: the rules, then `{{profile}}`, then `{{guide}}`. The user part has `{{job}}`, `{{ad}}` and `{{today}}` (cover letter only). The rules are the Global Constraints, plus:
  - Markdown only, with no preamble.
  - Resume: `# Name`, a contact line, a summary, experience (newest first), skills and education.
  - Cover letter: under one page, dated `{{today}}`.
- **Generate.** `GenerateRequest = { kind }` and `GenerateChunk = discriminatedUnion('kind', [{ kind: 'text', text }, { kind: 'done' }, { kind: 'error', message }])`.
  - `DocumentsService.generate(jobId, kind, { signal }): AsyncIterable<string>`. It checks the job (404) and the master profile (400, with the no-profile copy) **before** returning.
  - It uses the newest posting's ad text and the queue key `doc-<jobId>-<kind>`.
  - Route: `POST /jobs/:id/documents/generate` replies `application/x-ndjson`, one `GenerateChunk` per line, ending with `done` or `error`.
  - `reply.raw` `close` before the end aborts the task (the ratings route's pattern). Nothing is saved.
- **The API client.** `generateDocument(jobId, kind, { signal }): AsyncGenerator<GenerateChunk>` reads the lines as they arrive. An HTTP error before the stream becomes an `ApiError`, as elsewhere.
- **The fakes:**
  - `FakeAiProvider.thinking` (default `''`): `chat` returns it, and `chatStream` yields it first as a `thinking` chunk.
  - `chunkDelayMs` (default 0) waits between stream chunks and honours the signal.
  - The smart fake answers a request with no schema whose system prompt mentions "resume" or "cover letter" with a canned document. It uses only facts from the e2e profile.

- [ ] **Step 1: Write the failing tests:**
  - `write.test.ts` (`ai` service with the fakes):
    - The stream yields the fake's words joined back to its text, and none of its `thinking`.
    - The request has `thinking: true`, `thinkingEffort: 'medium'` and `maxTokens: 8192`.
    - The system message holds the profile, and the user message holds the job and ad.
    - Aborting the signal mid-stream (with `chunkDelayMs`) rejects with an AbortError, and the queue is idle afterwards.
    - A `parseJob` queued during a stream starts only after the stream ends.
  - Documents API:
    - The NDJSON reply's text lines join to the fake's document, and the last line is `{ kind: 'done' }`.
    - With no master profile it's a 400 with the copy.
    - An AI that can't be reached gives a last line `{ kind: 'error', message: FAIL_MESSAGE }`.
    - The stream saves no document (`list` is empty afterwards).
    - Closing the request mid-stream (a real listening app, with `fetch` and an AbortController) leaves the AI queue idle within 1 s, and `provider.finished` doesn't count it.
  - `api-client.test.ts`: lines split across network chunks are rejoined, and a 400 before the stream throws an `ApiError` with the server's message.
  - `settings-example.test.ts` passes with the new `tasks.write` block.
- [ ] **Step 2: Run** `npx vitest run server/modules/ai server/modules/documents shared/api-client.test.ts tests/settings-example.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `writeDocument` is an async generator: queue work pumps `chatStream` text into a small buffer with a waiter. The generator's `finally` aborts the work's controller when the consumer stops early.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

**Checkpoint review after Task 5:** a fresh Opus reviewer covers Tasks 1–5. Fix every critical and important finding, with a test that fails first.

---

### Task 6: Attachments, and backups of files

**Files:**
- Create: `server/modules/documents/files.ts` (`cleanFileName`, `ATTACH_TYPES`, `attachmentPath`), `server/modules/documents/attachments.test.ts`.
- Modify:
  - `server/modules/documents/{service,repo,routes}.ts`
  - `server/modules/system/service.ts` (`filesDir`, plus `mirrorFiles` in the backup pass) and `system.test.ts`
  - `server/app.ts`
  - `shared/contracts/documents.ts` (`AttachmentKind`, `Attachment = { id, jobId, kind, fileName, sizeBytes, createdAt }`)
  - `shared/api-client.ts` (`attachFile(jobId, kind, file: Blob, name)` with `FormData`)
  - `package.json` (`@fastify/multipart@^10`)

**Interfaces (produces):**
- `cleanFileName(raw: string): string`:
  - It keeps the part after the last `/` or `\`.
  - It drops control characters and `<>:"|?*`, and trims spaces and dots.
  - It prefixes `_` to a Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`, with any extension).
  - It cuts the name to 100 characters, keeping the extension, and gives `file` when nothing is left.
- `DocumentsService`:
  - `attach(jobId, { kind, fileName, data: Buffer }): Attachment`:
    - It checks the job, the type (by extension) and the size.
    - It writes `data/files/<jobId>/<8 hex>-<clean name>` after checking that the resolved path is inside that folder.
    - Then it inserts the row, and removes the file if the insert fails.
    - It emits `attachment.added`.
  - `listAttachments(jobId): Attachment[]`, newest first.
  - `attachmentFile(id): { attachment: Attachment; path: string }`.
- Routes:
  - `POST /jobs/:id/attachments?kind=resume|cover_letter|other` is multipart with one `file` part, limited to 15 MB. Over the limit it's a 400 with the copy.
  - `GET /attachments/:id` sends the file with the right `Content-Type` and `Content-Disposition: attachment`.
- `SystemOptions.filesDir`. The backup copies each file in `filesDir` to `<backupDir>/files/`, when it's missing there or its size or mtime differ. It never deletes.

- [ ] **Step 1: Write the failing tests:**
  - Upload a PDF, then download the same bytes with `content-disposition: attachment`.
  - 16 MB is a 400: "That file is over 15 MB."
  - `../../evil.exe` is a 400: "Attach a PDF, Word or text file."
  - `..\..\cv.pdf` is stored as `cv.pdf` under `files/<jobId>/`. `CON.pdf` becomes `_CON.pdf`. `🚀 résumé.pdf` keeps its emoji and accent. A 300-character name is cut to 100 and ends in `.pdf`.
  - An upload to job 999 is a 404, and nothing is written.
  - An extension origin can attach, since it's a write from an allowed origin. This is a ruling: harmless.
  - A backup copies a new file, updates a changed one, and keeps a copy whose source was removed.
- [ ] **Step 2: Run** `npx vitest run server/modules/documents server/modules/system`. Expected: FAIL.
- [ ] **Step 3: Implement.** `npm install @fastify/multipart@^10`, registered inside the documents routes plugin only.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

---

### Task 7: The call sheet's documents

**Files:** `server/modules/callsheet/{service,index}.ts` and `callsheet.test.ts`, `shared/contracts/callsheet.ts`, `server/app.ts`.

- **Interfaces (produces):** `CallSheet` gains three fields, so the job page needs one request:
  - `documents: DocumentSummary[]` (newest first)
  - `attachments: Attachment[]`
  - `sent: SentDocuments`
- [ ] **Step 1: Write the failing test.** The call sheet lists two resume versions and an attachment. After v1 is marked sent, `sent.resume` is v1 and `sent.coverLetter` is null.
- [ ] **Step 2: Run** `npx vitest run server/modules/callsheet`. Expected: FAIL.
- [ ] **Step 3: Implement.** The callsheet calls `documents.list`, `listAttachments` and `latestSent`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

---

### Task 8: Settings → Profile and Templates (dashboard)

**Files:** create `web/src/components/ProfileFilesSection.svelte` and `tests/e2e/profile.spec.ts`. Modify `web/src/pages/SettingsPage.svelte`, `shared/api-client.ts` (`getProfileFile`, `putProfileFile`), `tests/e2e/serve.ts` (reset restores the profile and templates), and `tests/e2e/helpers.ts`.

- **Two sections:**
  - "Profile": master profile, preferences, resume guide, cover letter guide.
  - "Templates": resume.css, cover-letter.css.
- Each file has a labelled monospace text area, **Save** (disabled until changed), and "Saved." or the error.
- An empty master profile shows a placeholder: a short example structure (`# Your Name`, contact line, roles with dates and results, skills, education).
- [ ] **Step 1: Write the failing e2e test.** Open Settings, type into "Master profile", and Save. The API's `GET /profile/master-profile` returns the new text. Reloading shows it. The templates section shows the starter `resume.css`.
- [ ] **Step 2: Run** `npm run test:e2e -- tests/e2e/profile.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS in Firefox and Chromium.

---

### Task 9: Documents on the job page

**Files:** create `web/src/components/DocumentsPanel.svelte` and `web/src/lib/documents.ts` (with `documents.test.ts`). Modify `web/src/pages/JobPage.svelte`, `web/src/components/CallSheet.svelte`, `web/src/lib/live.svelte.ts` (`JOB_EVENTS` gains `document.saved`, `document.sent` and `attachment.added`), and `tests/e2e/documents.spec.ts`.

- `web/src/lib/documents.ts`:
  - `versionLabel(d)` gives "Version 3 · edited · 28 Oct", or "Version 2 · sent 27 Oct".
  - `KIND_LABEL` maps each kind to "Resume" or "Cover letter".
  - `sentLine(sent)` gives "Sent: Resume v2 (27 Oct) · Cover letter v1 (28 Oct)", or null.
- **The panel**, per kind:
  - The versions, each a link to `/jobs/:id/documents/:docId`.
  - **New resume** or **New cover letter**, linking to `/jobs/:id/documents/new?kind=`.
  - **Attachments**: a list with download links, and **Attach file** (a file input plus a kind select).
- The call sheet shows `sentLine` under the facts, with links.
- [ ] **Step 1: Write the failing tests:**
  - Unit: `versionLabel` and `sentLine` cases.
  - e2e: a seeded job with a sent resume shows "Sent: Resume v1"; attaching a small PDF lists it, and its link downloads it.
- [ ] **Step 2: Run** `npx vitest run web/src/lib/documents.test.ts`, then `npm run test:e2e -- tests/e2e/documents.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.

---

### Task 10: The document editor

**Files:** create `web/src/pages/DocEditorPage.svelte` and `web/src/components/{DocPreview,FactCheckList,CopyFromDialog}.svelte`. Modify `web/src/lib/router.svelte.ts` (route `{ name: 'document'; jobId; docId: number | null; kind: DocumentKind | null }`), `web/src/App.svelte`, `web/src/lib/documents.ts` (the draft store), and `tests/e2e/documents.spec.ts`.

- **Layout:** the text area on the left and `DocPreview` on the right. The preview is an iframe with `sandbox=""`, `title="Preview"` and `srcdoc = documentPage(...)`, updated 300 ms after typing. It uses the template (or `sentCss` for a sent version), plus a small `mark` style added for the preview only.
- **The fact-check** runs 300 ms after typing, against the master profile (loaded once) and `allow = [title, company, agency]`. It lists "Not in your profile: …" above the text area and highlights the flags in the preview. With no master profile, it says "Add your master profile to check facts."
- **Generate** (resume or cover letter, by kind) streams into the text area and shows **Stop**.
  - Stop, or an `error` line, keeps the text, and the error shows above the text area.
  - Replacing existing unsaved text asks first.
  - Thinking text never arrives, because the server only sends `text` chunks.
- **The version picker:** a select of this job's versions of this kind, using `versionLabel`.
- **The buttons:**
  - **Save version**: disabled when nothing has changed since the last save or load. Its origin is `generated` while the text is exactly what was generated, and `edited` otherwise. After saving, the page moves to the new id.
  - **Mark as sent**: asks "Mark version N as sent? It can't be changed after this." Then the page becomes read-only.
  - **Print / PDF**: opens `/documents/:id/render` in a new tab, with a hint to untick headers and footers.
  - One button per exporter: a download link to `/documents/:id/export?format=`.
  - **Start from another job's version** opens `CopyFromDialog`, which lists `GET /documents?kind=` with job names. Picking one saves a copy and opens it.
- **A sent version:** the text area is read-only, with "Sent on {date}. Save a copy to change it." and a **Save a copy** button (`copyFrom` on the same job).
- **Unsaved text** is kept in `localStorage` under `jr-draft:<jobId>:<kind>`, cleared on save. Opening the editor with a draft offers "You have unsaved text from {time}. **Restore** · **Discard**". `beforeunload` warns while there is unsaved text.
- [ ] **Step 1: Write the failing e2e tests** (`documents.spec.ts`, with the smart fake):
  - Generate a resume: the text area fills with the canned resume. Save gives "Version 1 · generated". Mark as sent makes the text area read-only.
  - The done criterion: two jobs each get a sent resume. Settings → Templates gets `h1 { color: rgb(200, 0, 0); }`, saved. Each sent version's preview `h1` and its print view `h1` keep their old colour. A new unsent version's preview turns red.
  - Typing "Grew sales by 40%" shows "Not in your profile: 40%", and the preview has `<mark>40%</mark>`.
  - Slow mode: Stop during generation leaves partial text, unsaved, and the version list doesn't change.
  - The print view renders the document's `h1`, and its response carries the CSP header.
  - "Start from another job's version" copies job A's resume onto job B as "Version 1 · copied".
  - A draft survives a reload and can be restored.
- [ ] **Step 2: Run** `npm run test:e2e -- tests/e2e/documents.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:e2e`. Expected: everything passes (Firefox, Chromium and the extension).

---

### Task 11: Docs, checklist and the final review

- **Final review:** a fresh Opus reviewer covers the whole phase. Fix every critical and important finding with a test that fails first.
- **architecture.md:**
  - §4.1 (the `profile` and `documents` functions as built)
  - §5 (`attachment.added`, plus `profile.changed` now sent)
  - §6.4 (the exporter folder)
  - §8 (the tables as built)
  - §9 (routes: NDJSON generate, `GET /documents?kind=`, `?kind=` on attachments)
  - §10 (the editor, the draft store)
  - §12.1 (`tasks.write`)
  - §13 (attachments, CSP, file backups, starters)
  - §15 (`exporters/` in `adapters-only-from-index`)
- **README:** "Resumes and cover letters" and "Your profile".
- **`docs/checklists/phase-4-windows.md`:**
  - paste your real master profile
  - generate with Bonsai (time it, look for invented facts)
  - print to PDF in Firefox (headers and footers off, A4)
  - export a .docx and open it in Word for the web or ONLYOFFICE
  - check the done criterion by hand
  - attach a real PDF
  - check the backup's `files/` folder.
- **CLAUDE.md:** the status, plus notes for Phase 5. The Gmail app-password recheck is at the start of Phase 5.
- **Verify:** `npm test`, `npm run test:e2e` and `npm run ext:lint`, with the results in the ledger.
