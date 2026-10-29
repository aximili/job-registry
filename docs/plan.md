# Job Registry — plan

> **Status:**
> - **Approved:** 28 Oct 2026.
> - **Phase 0** (architecture document) is in review. See [architecture.md](architecture.md).
> - **Updated:** small refinements from the architecture work. They are listed in architecture.md §18 and already applied below.
> - **Phases 1–6** are built and tested on macOS (Phase 5, Gmail, and Phase 6, follow-up reminders and the board, on 29 Oct 2026). From Phase 6 you chose follow-up reminders and the Kanban board, not phone access or the Windows-wide hotkey. See CLAUDE.md for the current status.

## Context

When you're job hunting you apply to 100+ roles, and you can't remember the details of each one. When a recruiter calls out of the blue, you need the right job on screen within seconds. Today nothing exists. The project folder is empty and there's no data to import.

**What we're building:** a personal app that runs locally on Windows. It lets you:

- save a job in one click from the browser, or by pasting a URL or the job description
- track its status, notes and contacts, with a log of each conversation
- find any job instantly while a recruiter is talking
- use a **local** AI model to read job ads, rate how well each one matches you, and draft a tailored resume and cover letter from your master profile.

**What you told me:**
- **PC:** RTX 3090 (24 GB), shared with other apps. The AI must be swappable, for example to Ollama.
- **Browser:** mostly Firefox. Chrome support would be nice too.
- **Job sites:** Seek, LinkedIn and Indeed.
- **Documents:** edit as text with a live preview, then print to PDF. You don't have Word.
- **Profile:** you already have a master profile document.
- **Recruiter call:** must handle "I'm at my PC and they name the company". Phone-number lookup, phone access and agency roles are nice to have.
- **Extension:** nice to have a match rating with reasons for and against on each job ad.
- **Gmail:** status updates from email are a bonus, and only with your confirmation.

## Goals, non-goals, anti-goals

- **Goals:** fast to save, fast to find, simple to run (double-click a `.bat`), easy to maintain.
- **Non-goals (for now):** multi-user accounts, cloud sync, a mobile app, a polished installer.
- **Anti-goals.** These would make it a failure even if it works:
  - Saving a job has to wait for the AI.
  - The AI makes up experience on a resume.
  - A status changes from an email without your OK.
  - Any of your data leaves your PC.

## Architecture (your idea, kept, with a few changes)

```
Firefox / Chrome extension ──► Local server (Node.js, 127.0.0.1:4777) ──► SQLite file (data/jobs.db)
Dashboard (browser tab)    ──►        │                                 ──► profile/*.md, templates/*.css
                                      └──► Local AI (any OpenAI-compatible server)
                                             default: PrismML llama-server + Bonsai 2 27B
                                             or: Ollama / LM Studio / other
```

- **One language everywhere:** TypeScript for the server, dashboard and extension. Node runs the server's `.ts` files directly (built-in type stripping), so the server needs no compile step.
- **Server:** Node.js LTS + Fastify. It serves the API and the built dashboard. It binds to `127.0.0.1` only. It rejects requests unless the Origin is the dashboard or a browser extension and the Host is localhost. This stops random websites from reading your data.
- **Database:** SQLite via `better-sqlite3`, using plain SQL migrations and no ORM. Search uses SQLite FTS5.
- **Dashboard:** Svelte 5 + Vite, built once during setup into static files.
- **AI:** any server that speaks the OpenAI chat API, set in Settings. This matters because **Bonsai 2 runs only on PrismML's own build of llama.cpp** for now. Ollama can't load it yet. Presets:
  1. **Bonsai 2 via PrismML llama-server** (default). The app starts and stops it for you.
  2. **Ollama**
  3. **LM Studio**
  4. **Custom URL**
- **Startup:** `start.bat` runs the Node server, which opens the dashboard. The server starts the AI **only when it's first needed**. It stops the AI after 15 idle minutes to free GPU memory for your other apps. Both the idle time and the model are settings.

## Architecture rules (loose coupling)

These rules keep each part replaceable and easy to change. The Phase 0 document explains them in detail, and a check script enforces them.

1. **Feature modules, not layers.**
   - The server is split by feature: `jobs`, `contacts`, `notes`, `search`, `documents`, `capture`, `ai`, `email`, `settings`, `profile`, `ratings`, `enrich`, `callsheet`, `live`, `system`. The architecture doc lists what each one owns.
   - Each module holds its own `routes.ts` (HTTP), `service.ts` (the logic) and `repo.ts` (SQL).
2. **Modules only touch each other through a service's public functions or through events.**
   - No module reads another module's tables or imports its `repo.ts`.
   - Example: `search` keeps its index up to date by listening to events like `job.saved` and `note.added`. It doesn't query the jobs tables.
3. **The logic knows nothing about HTTP or SQLite.**
   - Services take plain inputs and return plain results.
   - Fastify stays in `routes.ts`. SQL stays in `repo.ts`.
   - So you can test the logic without a server, and swap the web framework or the database later.
4. **Anything outside the app sits behind a small interface (a "port"), with swappable parts behind it ("adapters"):**
   - `AiProvider`: one OpenAI-compatible adapter covers llama-server, Ollama and LM Studio. A cloud adapter could be added later. `LlamaServerRuntime` is a separate, optional part that only starts and stops the process.
   - `MailSource`: IMAP today, the Gmail API later if needed.
   - `DocumentExporter`: print HTML today, .docx next.
   - `SiteExtractor` (in the extension): Seek, LinkedIn, Indeed, generic. Adding a site means adding one file.
5. **AI tasks don't know about jobs, and `jobs` doesn't know about the AI.**
   - `ai.parseJob(text)` returns `ParsedJob`, and `ai.rateJob(...)` returns `Rating`.
   - A separate `enrich` module listens for new ads, calls the AI and hands the results to `jobs`. So saving can never wait for the AI, and the AI module can be tested with plain text.
6. **One shared contract.**
   - `shared/` holds the zod schemas and types for every API request and response, plus a thin typed API client.
   - The server, dashboard and extension all import them, so a change to the API breaks the build, not the app at runtime.
   - The API is versioned under `/api/v1`.
7. **One composition root.**
   - `server/app.ts` builds every adapter, repo and service and connects them. This is plain manual wiring, with no dependency-injection framework.
   - Tests build the same app with fake adapters, such as a fake AI and an in-memory database.
8. **Enforced, not just documented.**
   - `npm run check:deps` (dependency-cruiser) fails when a rule above is broken. For example: a module importing another module's repo, or `ai` importing from `jobs`.
   - It runs together with the tests.

## Data model (SQLite)

- `jobs` (the role itself):
  - `id`
  - `title`, `company`, `agency`: the agency field covers recruiters hiding the employer
  - `location`, `work_mode`, `employment_type`
  - `salary_min`, `salary_max`, `salary_period`, `salary_text`
  - `closing_date`, `status`, `date_applied`
  - `summary`, `requirements` / `nice_to_have` / `responsibilities` (JSON lists)
  - `parse_state`, `match_verdict`, `match_json`
  - `created_at`, `updated_at`, `archived`
- `postings` (one or more ads behind each job, such as the Seek ad, the LinkedIn copy and an agency repost):
  - `job_id`
  - `canonical_url`, `source_site`, `external_id`: used for exact "already saved" lookups
  - `jd_text`: a **snapshot of the ad**, because ads get taken down
  - `captured_at`
- `status_history`: job, from, to, when, source (manual or email).
- `notes`: job, body, when.
- `jobs` also records where each field came from (you, the ad's structured data, or the AI). The AI never overwrites a field you edited.
- `contacts`: name, role, company or agency, email, phone, phone_digits (normalised, so "0412 345 678" matches "+61412345678"), LinkedIn, notes.
- `job_contacts`: links people to jobs. One recruiter can cover several roles.
- `interactions`: contact, job (optional), type (call, email, meeting or message), when, notes. This is the conversation log.
- `documents`: job, kind (resume or cover letter), markdown, version, `is_sent`, `sent_css` (the template frozen when sent), when. Rows are only ever added, never overwritten.
- `attachments`: job, kind, file name, path in `data/files/`, when.
- `rating_cache`: canonical URL + profile hash → rating. It covers jobs you rated but didn't save.
- `email_suggestions` (Phase 5).
- `search_index`: one FTS5 table, updated by app code on every write. It covers company, agency, title, contact names, phones and emails, notes and the ad text.

**Settings** live in `config/settings.json`, which you can edit by hand or on the Settings page. The status list lives there too and is editable. Default statuses:

- **Open:** Saved → Applied → Screening → Interview 1 → Interview 2 → Final interview → Offer → Accepted
- **Closed:** Rejected · Withdrawn · No response

Moving a job to Applied sets `date_applied` automatically.

Each status has a stable id plus a `setsAppliedDate` flag, so renaming a status never breaks history. Secrets, like the IMAP app password, live in their own git-ignored `config/secrets.json`.

## Key user flows

**Recruiter calls ("call sheet")**
- The dashboard opens with the cursor already in a big search box. `/` or `Ctrl+K` jumps back to it from anywhere.
- Type 3 letters of a company, agency, person, or any part of a phone number. Results appear as you type, best match first. Arrow keys and Enter open one.
- The job page starts with a one-screen **call sheet**:
  - company, role, agency or recruiter, status, date applied, salary, location and work mode
  - match verdict and the key requirements
  - your latest notes and the people involved
- Buttons on the call sheet:
  - **Log call:** pick or create a contact, type notes, save. It should take under 10 seconds.
  - **Add note**
  - **Change status**
- Below the call sheet: the full saved ad, documents (marking which version was sent), and a timeline of status changes, notes and calls.

**Save a job (extension, the main way)**
- On Seek, LinkedIn and Indeed job pages, including the split-pane search views, a small panel shows up in the corner:
  - If the job is already saved, it shows "Saved · Applied 12 Oct". Click it to open the job in the dashboard.
  - If not, it shows **Save** with a status choice (Saved or Applied) and an optional note.
- One click saves the job **at once** with the raw ad text. AI parsing then fills in the fields in the background.
- On any other site, the toolbar popup (or `Alt+Shift+J`) offers "Save this page". It uses the page's JobPosting data, then a readable-text extraction, or your highlighted text if you selected some.
- Each site has its own small file (`sites/seek.ts`, `linkedin.ts`, `indeed.ts`), with a generic fallback for everything else. When a site changes its layout, only one small file needs fixing.

**Same role, different ad (duplicates)**
- **Exact match:** same canonical URL or site job ID. The panel shows "Saved · Applied 12 Oct".
- **Likely match:** the same company (after dropping endings like "Pty Ltd") and a close title among open jobs from the last 6 months. The panel and the "+ New" flow both ask: "Looks like *Senior Engineer at Atlassian* (from Seek, Applied 12 Oct). **Same job** / **Different job**".
  - **Same job** adds the ad as another posting on that job.
  - **Different job** saves it as a new job.
- **Agency repost with the employer hidden:** this uses a weaker match on title and location only, and is shown as "possibly the same as…". It's never linked without your click.
- The matching lives in `server/modules/jobs/match.ts`. It's plain code, not AI, so it's instant.

**Save a job (dashboard)**
- Paste text or a URL into "+ New", or press `Ctrl+V` anywhere on the dashboard.
- For a URL, the server tries to fetch it. Seek, LinkedIn and Indeed often block that, so it tells you to use the extension or paste the text.

**Match rating (in the extension, and shown on saved jobs)**
- Uses your `master-profile.md` plus a short `preferences.md` (roles you want, salary floor, locations, work mode, deal-breakers).
- Shows a verdict (Strong, Good, Stretch or Weak), a score, up to 4 reasons for, up to 4 reasons against, and any deal-breakers hit.
- Runs automatically on job pages, with an on/off toggle. If you click through jobs quickly, it cancels the stale request.
- Results are cached by the ad (its link and a short hash of its text) and the profile version.
- The profile comes first in the prompt, so llama-server reuses its cache and each rating takes a few seconds.

**Resume and cover letter**
- Your files: `profile/master-profile.md` (paste your existing doc), `preferences.md`, `resume-guide.md`, `cover-letter-guide.md`. Styling: `templates/resume.css` and `templates/cover-letter.css`. You can edit them in the app or in any text editor. Starter versions are included.
- **Generate** streams Markdown into an editor: text on the left, a live A4 preview on the right.
- The prompt rules say to use only facts from the master profile, never invent numbers, and use Australian spelling.
- **Light fact-check.** This is plain code (`shared/fact-check.ts`), not AI. It runs in the browser, so it can keep up with your typing.
  - It pulls every number, percentage, dollar amount, year or date range, and capitalised name (employers, job titles, certifications, tools) out of the draft.
  - It highlights any of them that don't appear in `master-profile.md`.
  - Highlights show in the preview, with a short list above the editor: "Not in your profile: 40%, AWS Certified Solutions Architect".
  - It re-runs as you type. It never blocks saving or sending.
- **Every resume and cover letter is kept, per job.**
  - Each **Save version** adds a new version. Nothing is overwritten.
  - **Mark as sent** freezes that version with a copy of the template CSS as it was then. Later template changes never alter what you sent, so you can view or reprint it exactly.
  - The sent resume and cover letter show on the call sheet, so you can see "what did I send them?" during a call.
  - **Start from another job's version** copies a past document as the starting point.
  - **Attach file** stores a PDF or DOCX you made outside the app (for example, one sent before you had this app) in `data/files/`, linked to the job.
- **Print / PDF** uses Firefox's built-in "Save to PDF". You may need to untick headers and footers in the print dialog once.
- **Export .docx** comes later in Phase 4 for agencies that want Word. It maps Markdown to Word with the `docx` library. Open the result in ONLYOFFICE or Word for the web, both free.

**Gmail (bonus, Phase 5)**
- Connects over IMAP with a Gmail **app password**. This needs 2-Step Verification on your Google account, and the setup is pasting one password.
- The Gmail API is not a good fit for personal use. Its OAuth tokens expire every 7 days while an app is in Google's "testing" mode.
- Polls every 10 minutes, plus a "Check now" button. A cheap first filter keeps only emails that match a job's company, agency or contact domain, or contain application keywords.
- The AI classifies each match as received, rejected, interview invite, assessment, offer or other.
- Each one appears as a card in the dashboard **Inbox**: "Rejection from Atlassian → mark *Senior Engineer* as Rejected?" with **Confirm**, **Pick another job** and **Dismiss**.
- Confirming logs the status change (source: email) and a note with a one-line summary. The app stores only summaries, not full emails.

## AI module design

- `server/modules/ai/adapters/openai-compatible.ts`: OpenAI-style chat calls through `fetch`. It handles streaming, JSON-schema output (`response_format`), cancelling and timeouts.
- `server/modules/ai/runtime/llama-server.ts`: the managed llama-server process. It starts on demand, checks `/health`, stops after the idle time and stops when the app closes. Default arguments come from PrismML's docs: `-ngl 99 -fa on -c 32768 --jinja --port 8080`. The 27B model uses about 6 GB plus about 2 GB for its working memory at 32K context, so it fits beside your other apps.
- `server/modules/ai/queue.ts`: one AI job at a time, because there's one GPU. Priority order: rating (you're waiting) > parse > background email work.
- `server/modules/ai/tasks/`:
  - `parse-job.ts`
  - `rate-job.ts`
  - `write-resume.ts`
  - `write-cover-letter.ts`
  - `classify-email.ts`

  Each task is a prompt plus a zod schema (turned into JSON Schema for constrained output), with validation and one retry. The prompts are text files in `server/modules/ai/prompts/`.
- Each task can have its own settings in `settings.json`: model, temperature, thinking on or off, extra request fields.
  - Default: thinking **off** for parsing, rating and email (`reasoning_effort: "none"`), and **on** for resume and cover letter (`reasoning_effort: "medium"`).
  - Ollama's OpenAI-style API uses the same field, so no preset needs its own mapping. (Changed in Phase 2: Bonsai 2's template ignores `chat_template_kwargs` for this.)
- A header pill shows the AI state: off, loading, ready or busy. It also shows a clear hint if the AI server can't be reached.

## Windows setup and running

- **`setup.bat`** is run once. It calls `scripts/setup.ps1`, which:
  1. Checks that a supported Node LTS is installed. If not, it prints `winget install OpenJS.NodeJS.LTS`.
  2. Runs `npm ci` and builds the dashboard and the extension.
  3. Creates `data/` and `config/settings.json`. The app copies in the starter writing guides and templates the first time it starts (changed in Phase 4).
  4. Offers to download PrismML's Windows CUDA llama.cpp release and the Bonsai 2 27B GGUF into `ai/`.
  5. Offers to create a Desktop shortcut, and optionally a login auto-start, so the app is already running when a recruiter rings.
- **`start.bat`** starts the server minimised and opens the dashboard. If the server is already running, it just opens the dashboard.
- **`stop.bat`** stops the server and the AI.
- **Backups:** on each start, the app copies the database to `data/backups/` and keeps 14 days. You can set the backup folder to something like OneDrive. Keep the live database out of OneDrive, because syncing can corrupt SQLite.
- **Extension install:**
  - **Firefox:** normal Firefox only keeps unsigned extensions until restart. `npm run ext:sign` uses `web-ext sign --channel=unlisted`, which needs a free addons.mozilla.org account and API key. It produces a private `.xpi` that stays installed and is not public.
  - **Chrome:** turn on Developer mode, then "Load unpacked" from `extension/dist/chrome`.

## Folder layout

```
setup.bat  start.bat  stop.bat  start.sh (Mac/dev)
scripts/     setup.ps1, download-ai.ps1, make-shortcuts.ps1
config/      settings.example.json         (settings.json is git-ignored)
profile/     master-profile.md, preferences.md, resume-guide.md, cover-letter-guide.md
templates/   resume.css, cover-letter.css
data/        jobs.db, backups/, files/      (git-ignored)
ai/          llama.cpp binaries + models    (git-ignored)
docs/        architecture.md (Phase 0), decisions/ (one short file per key decision)
CLAUDE.md    project guide for future sessions: points to the plan, the architecture doc and the rules
shared/      contracts/ (zod schemas + types per API), api-client.ts, canonical-url.ts, phone.ts,
             fact-check.ts, markdown.ts
server/      main.ts (entry), app.ts (composition root)
             core/       config, db (connection + migrations/*.sql), events (typed map + emitter), errors, logger
             modules/    jobs/       routes, service, repo, match.ts (duplicates)
                         contacts/   contacts + interactions (call log)
                         notes/
                         search/     FTS index (fed by events) + query
                         documents/  versions, freeze-on-send, attachments, exporters/ (print-html, docx)
                         capture/    fetch-url, jsonld
                         ai/         provider.ts (port), adapters/openai-compatible.ts,
                                     runtime/llama-server.ts, queue.ts, tasks/*, prompts/*.md
                         ratings/    rating cache + rate()
                         enrich/     runs parse + rate after each new ad
                         callsheet/  read-only one-screen view
                         email/      mail-source.ts (port), adapters/imap.ts, classifier, suggestions
                         profile/    profile and template files
                         settings/   settings.json + secrets.json
                         live/       server-sent events to the dashboard
                         system/     health, backups, shutdown
web/         Svelte app: Search, JobList, CallSheet, JobDetail, DocEditor, Settings, Inbox
extension/   manifest.base.json, manifest.firefox.json, manifest.chrome.json, build.mjs,
             src/ (background, content, messages.ts, panel/, popup/, options/,
                   sites/{seek,linkedin,indeed,generic}.ts)
             The content scripts never call the server. The background script makes every call.
tests/
```

## Build phases (each one is usable on its own)

0. **Architecture document. You review and approve it before any code is written.**
   - `docs/architecture.md`, more detailed than this plan. Diagrams are in Mermaid: text-based, kept with the code, and shown by VS Code's "Markdown Preview Mermaid Support" extension or on GitHub. It covers:
     - **System context:** you, the browser, the extension, the app, the local AI and Gmail.
     - **Containers:** server, dashboard, extension, SQLite, files, AI process, and what talks to what, over which protocol.
     - **Server components:** each module, its public functions, the events it sends and listens to, and the allowed dependency directions.
     - **Ports and adapters:** `AiProvider`, `LlamaServerRuntime`, `MailSource`, `DocumentExporter`, `SiteExtractor`, each with its interface written out.
     - **Sequence diagrams** for the key flows: save from the extension (including "Same job?"), the recruiter-call search, match rating (including cancelling a stale one), resume generation with the fact-check, and an email suggestion through to confirm.
     - **Data model:** an entity-relationship diagram (ERD) with every table and key.
     - **Shared API contract:** the endpoint list and how `shared/contracts` is used.
     - **Cross-cutting concerns:** config, errors, logging, security (localhost, Origin/Host checks), backups, migrations.
     - **Testing strategy:** what is tested at each level, and which fakes are used.
     - **The dependency rules**, and how `check:deps` enforces them.
     - **How to extend:** add a job site, swap the AI provider, add an export format, add a status.
   - `docs/decisions/`: one short file per key choice (what, why, what else was considered). Examples: Node over Python, Svelte, SQLite + FTS5, OpenAI-compatible AI, IMAP over the Gmail API, Markdown documents.
   - Copy this plan into the project as `docs/plan.md`, so it travels with the code.
   - Also add a project `CLAUDE.md`. It points future sessions to the plan, the architecture doc and the rules, so each phase can start in a fresh session.
   - *Done when:* you've read and approved the architecture doc. If writing it reveals a better design, I update this plan to match first.
1. **Core registry, no AI yet.**
   - `.bat` scripts, server, database, dashboard search, list with status filters, call sheet, status history, notes, contacts and the call log.
   - Add a job by pasting text or a URL. The URL path reads the page's JobPosting data where it exists.
   - Jobs and postings are separate tables from day one, with the "Same job / Different job" prompt.
   - *Done when:* `start.bat` opens the dashboard, and a job is found by part of a company name or phone number in under 2 seconds.
2. **Local AI.**
   - AI settings with presets and a "Test connection" button, the managed llama-server, and the queue.
   - Job parsing fills in the fields. Match ratings show on saved jobs.
   - *Done when:* a pasted Seek ad fills in company, title, salary and requirements in about 20 seconds or less. Switching to Ollama works by changing settings only.
3. **Browser extension.**
   - Firefox first, then the Chrome build.
   - Site files for Seek, LinkedIn and Indeed, plus a generic fallback.
   - Floating panel with save and match rating, toolbar popup, keyboard shortcut, Firefox signing.
   - *Done when:* clicking through 5 Seek results shows a rating on each, and saving takes one click.
4. **Resume and cover letter.**
   - Profile and template editors, streamed generation, editor with live preview, light fact-check highlights, versions, "sent" marker that freezes the document, file attachments, print to PDF, then .docx export.
   - *Done when:* two jobs each have their own sent resume, and changing `resume.css` afterwards doesn't change how either sent version looks.
5. **Gmail (bonus).** IMAP, the first filter, AI classification, and the Inbox with confirm.
6. **Nice-to-haves, only if easy:**
   - phone access over home Wi-Fi with a passcode (the dashboard is responsive anyway)
   - a Windows-wide hotkey through the Desktop shortcut's "Shortcut key" setting
   - a Kanban board view
   - follow-up reminders.

## Choices I made (override any of them)

You chose the light fact-check (no blocking), and "Same job?" suggestions across sites. Everything below is my call:

- Node.js + TypeScript rather than Python, so one language covers everything.
- Fastify, better-sqlite3, Svelte (for the dashboard and the extension's popup and panel) and esbuild.
- Settings and profile live in files you can edit by hand. Jobs live in SQLite.
- IMAP rather than the Gmail API.
- The match rating runs automatically on job pages, with a toggle.
- Port 4777.
- The AI loads on demand and stops after 15 idle minutes.

## Verification

- **Architecture rules:** `npm run check:deps` passes. A deliberately bad import fails it: for example, `ai` importing from `jobs`, or one module importing another's `repo.ts`.
- **Unit tests (Vitest):**
  - canonical URLs for Seek, LinkedIn and Indeed, including the split-pane URLs
  - JobPosting data extraction
  - phone-number matching
  - duplicate matching: exact, likely and agency cases, plus clear non-matches
  - fact-check: invented numbers and names get flagged, but ones from the profile don't, even when written differently (for example "30 %" and "30%", or "2019–2021" and "2019-2021")
  - search ranking
  - each AI task's schema check, against a fake OpenAI-style server.
- **API tests:** `fastify.inject` against a temporary database. Cover:
  - save, duplicate detection, status history, search and the call log
  - documents: saving a version adds a row, and a sent version can't be edited
  - attachments
  - the Origin/Host check.
- **End-to-end tests (Playwright) on the dashboard:**
  - paste a job, search it, change its status, log a call
  - generate a document with the fake AI, edit it, check the preview
  - the print view renders.
- **AI quality check:** a small set of 8–10 real saved ads (Seek, LinkedIn, Indeed) with the fields filled in by hand. `npm run eval:parse` reports accuracy per field for whichever model is set.
- **Extension:** `web-ext lint`, plus a manual checklist on real Seek, LinkedIn and Indeed pages, including the split-pane views and clicking quickly between jobs.
- **Windows:** I'll build and test on this Mac. You'll need to run `setup.bat` and `start.bat` on your Windows PC once per phase to confirm the Windows-only parts: the scripts, the CUDA llama-server download and the shortcuts.
