# Job Registry

A personal, local-first app for tracking job applications. It runs on Windows: a Node server, a browser dashboard, a Firefox/Chrome extension, SQLite and a local AI.

## Read these first

1. [docs/plan.md](docs/plan.md): what we're building, the phases, and what "done" means for each phase.
2. [docs/architecture.md](docs/architecture.md): how it's built, covering modules, events, ports and adapters, data model, API and testing.
3. [docs/decisions/](docs/decisions/): why each key choice was made.

If the code and these documents disagree, stop and ask. Don't quietly follow one of them. If a change alters the design, update architecture.md (and §4.2 if dependencies change) in the same piece of work.

## Current status

- **Phase 0** (architecture document): approved 28 Oct 2026.
- **Phase 1** (core registry): built and tested on macOS on 28 Oct 2026 ([plan](docs/superpowers/plans/2026-10-28-phase-1-core-registry.md)).
  - **Windows checklist** ([docs/checklists/phase-1-windows.md](docs/checklists/phase-1-windows.md)): Setup and "Starting and stopping" pass on Windows. The user will run the rest later, together with the later phases' checklists, and fix anything then.
  - **Closed out** on 28 Oct 2026: the user's pick of the deferred minors (group A) is fixed. See "Phase 1 close-out" in the ledger, `.superpowers/sdd/2026-10-28-phase-1-core-registry/progress.md`.
- **Phase 2** (local AI): built and tested on macOS on 28 Oct 2026, against a fake AI server ([plan](docs/superpowers/plans/2026-10-28-phase-2-local-ai.md), ledger `.superpowers/sdd/2026-10-28-phase-2-local-ai/progress.md`).
  - **Windows checklist:** [docs/checklists/phase-2-windows.md](docs/checklists/phase-2-windows.md). Not run yet: the real Bonsai 2 model, `download-ai.bat`, llama-server start/stop with taskkill, Ollama.
  - The user hasn't added real ads for `npm run eval:parse` yet. `tests/fixtures/ads/` has three made-up examples.
- **Phase 3** (browser extension): built and tested on macOS on 28 Oct 2026 ([plan](docs/superpowers/plans/2026-10-28-phase-3-browser-extension.md), ledger `.superpowers/sdd/2026-10-28-phase-3-browser-extension/progress.md`).
  - **Windows checklist:** [docs/checklists/phase-3-windows.md](docs/checklists/phase-3-windows.md). Not run yet: real Firefox, signing (the user needs addons.mozilla.org keys), real signed-in Seek, LinkedIn and Indeed pages.
  - The site fixtures are hand-made (plus one real LinkedIn guest page). When the user saves real pages, check them with `npm run ext:check` and add them to `tests/fixtures/sites/`.
- **Phase 4** (resume and cover letter): built and tested on macOS on 28–29 Oct 2026, against a fake AI ([plan](docs/superpowers/plans/2026-10-28-phase-4-resume-cover-letter.md), ledger `.superpowers/sdd/2026-10-28-phase-4-resume-cover-letter/progress.md`). Both reviews (checkpoint and final) are closed, and their deferred minors are in the ledger.
  - **Windows checklist:** [docs/checklists/phase-4-windows.md](docs/checklists/phase-4-windows.md). Not run yet: Bonsai writing real drafts (timing, invented facts), Firefox's Save to PDF, a .docx in Word for the web or ONLYOFFICE, Windows file names.
  - The starter guides and templates live in `starters/` (tracked). The app copies them into `profile/` and `templates/` (both git-ignored) at start-up, wherever a file is missing. There's no starter master profile or preferences file.
- **Phase 5** (Gmail): built and tested on macOS on 29 Oct 2026, against a test IMAP server (hoodiecrow-imap), a fake mailbox and a fake AI ([plan](docs/superpowers/plans/2026-10-29-phase-5-gmail.md), ledger `.superpowers/sdd/2026-10-29-phase-5-gmail/progress.md`).
  - **Windows checks:** [docs/checklists/phase-5-windows.md](docs/checklists/phase-5-windows.md). Not run yet: a real Gmail login with an app password, TLS through antivirus email scanning, Bonsai reading real emails, the timer over 30 minutes.
  - The app password lives in `config/secrets.json` (git-ignored, never sent to the browser). Email is off until it's turned on in Settings → Email.
  - Both reviews (checkpoint and final) are closed. Their fixes are in, and the deferred minors are in the ledger.
- **Phase 6** (nice-to-haves): built and tested on macOS on 29 Oct 2026 ([plan](docs/superpowers/plans/2026-10-29-phase-6-nice-to-haves.md), ledger `.superpowers/sdd/2026-10-29-phase-6-nice-to-haves/progress.md`). The user picked **follow-up reminders** and the **Kanban board view** (asked once, as agreed). Not wanted: phone access over Wi-Fi, the Windows-wide hotkey.
  - **Windows checks:** [docs/checklists/phase-6-windows.md](docs/checklists/phase-6-windows.md). Not run yet: drag and drop in real Firefox on Windows, the Windows date picker, a follow-up across midnight.
  - Both reviews (checkpoint and final) are closed. Their fixes are in, and the deferred minors are in the ledger (including one timing flake in the extension's "five quick clicks" test).
- **Windows handover:** written 29 Oct 2026, in [docs/handover/](docs/handover/README.md): the runbook for Bonsai 2, the bug-list format, and the user's do-by-hand list. Its checks are `scripts/handover/*.ts` (tested in `tests/handover.test.ts`), plus `start-bonsai-server.bat` (Bonsai 2 on port 8080 for the agent and the app) and `setup.bat -Quiet`. Not run on Windows yet. When the user brings back `handover-results\` (summary.md, results.txt, the bugs folder, the logs), fix the bugs with tests that fail first.
- **How the user wants to work:**
  - (28 Oct 2026) "I just want the app finished the best you can." Build phase after phase, through Phase 6, without stopping for plan reviews or Windows tests. Don't ask about details: make the call and record it in the phase's ledger.
  - (29 Oct 2026) The user won't run checklists by hand. When everything is built, write a **Windows handover for Bonsai 2**, the local model, which is less capable. It's a step-by-step runbook it can follow on the Windows PC.
    - Each step has an exact command, the expected output, and what to do if the output differs. Prefer scripted PASS/FAIL checks over judgement.
    - It may fix only "very simple" things, defined in the runbook. Everything else goes into a bug list in a fixed format, which the user brings back to Claude.
    - Also give the user a short list of what only they can do by hand: start Bonsai 2 and the agent tool, paste the master profile, the AMO keys, the Gmail app password, and signing in to the job sites.
  - The `docs/checklists/phase-N-windows.md` files are input for that handover, not tasks for the user.
- **Deferred minors from Phase 3** (in its ledger): the popup's save doesn't set the badge; the panel is last in the tab order; a rating keeps running after you leave a job for an unreadable page; the badge can lag when replies arrive out of order.
- **Deferred minors from Phase 5** (in its ledger): a first check over about 300 seconds can make Firefox give up on Check now (it corrects itself); zod's own wording for a bad number in Settings → Email; card headings are h3 under the h1; secrets.json is 0644 on macOS; small timer gaps (saving a setting restarts it, turning email off doesn't stop a running check); a no-Message-ID email can repeat after a UIDVALIDITY reset.

Update this section when a phase starts or finishes.

## Commands

| Command | What it does |
|---------|--------------|
| `npm test` | Typecheck (tsc and svelte-check), then the architecture check (`check:deps`), then the unit and API tests (Vitest). |
| `npm run test:e2e` | Build the dashboard and the extension's test build, then run the browser tests: the dashboard in Firefox and Chromium, and the real extension in Chromium. It starts its own server on 4799 and copies of the job sites on 4798. |
| `npm run dev:server` + `npm run dev:web` | Development mode. The server runs on 4777, and the dashboard on 5173 with live reload. |
| `npm run build` | Build the dashboard into `web/dist` (the server serves it). |
| `npm start` | Run the server (`node server/main.ts`). |
| `npm run ext:build` | Build the browser extension into `extension/dist/{firefox,chrome}` (`--e2e` also builds `chrome-e2e` for the browser tests). |
| `npm run ext:lint` / `ext:sign` / `ext:check -- page.html URL` | Mozilla's checks; sign the Firefox build (needs `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET`); run a site reader on a saved page. |
| `node scripts/handover/<check>.ts` | The Windows handover checks (prereqs, make-test-copy, app-smoke, ai-smoke, eval-report, run-tests, sign, real-checks, cleanup, collect-logs, summary). See docs/handover/runbook.md. |
| `npm run eval:parse` | How well the AI in your settings reads job ads (a report, not a test). Uses `tests/fixtures/ads/`. `-- --settings FILE` uses another settings file. |

**Windows scripts:** `setup.bat`, `start.bat`, `stop.bat`, `download-ai.bat` and `start-bonsai-server.bat`, plus `scripts/setup.ps1` and `scripts/download-ai.ps1`, must stay plain ASCII with CRLF line endings (`.gitattributes` enforces CRLF). Windows PowerShell 5.1 misreads UTF-8 that has no byte-order mark.

## Architecture rules (summary; full detail in architecture.md §4 and §15)

1. **Feature modules.** The server lives in `server/modules/<name>/` with `index.ts`, `service.ts`, `repo.ts` and `routes.ts`. Other modules import only `index.ts`.
2. **Only the owning module touches its tables.** Modules talk through public services or typed events (`server/core/events.ts`).
3. **Services know nothing about Fastify or SQL.** Fastify stays in `routes.ts`, and SQL stays in `repo.ts`.
4. **Outside systems sit behind ports:** `AiProvider`, `ModelRuntime`, `MailSource`, `DocumentExporter` and `SiteExtractor`.
5. **`jobs` never depends on `ai`.** The `enrich` module does the AI work after a save. Saving must never wait for the AI.
6. **One shared contract.** Every API body is a zod schema in `shared/contracts/`, used by the server, dashboard and extension.
7. **Only `server/app.ts` wires things together.** No dependency-injection framework.
8. **`npm run check:deps` must pass.** Never weaken a rule to make it pass. Fix the import instead.

## Conventions

- **TypeScript:** erasable syntax only, because Node runs the server's `.ts` files directly. That means no `enum` and no constructor parameter properties.
- **Database:** plain SQL with no ORM. Every schema change is a new numbered file in `server/core/db/migrations/`, and old migrations are never edited.
- **Never overwrite your data:**
  - Documents are append-only, and sent versions are frozen.
  - Jobs are archived, not deleted.
  - The AI never overwrites a field you edited.
- **Writing:** plain English and Australian spelling in the UI, docs, comments and prompts.
- **Tests:** they sit next to the code (`*.test.ts`). Fakes for every port live in `tests/fakes/`.
- **AI prompts:** text files in `server/modules/ai/prompts/`, not strings in code.

## Platform notes

- **Where it runs:** the target is Windows (RTX 3090, Firefox first). Development happens on macOS, so `.bat` and `.ps1` scripts must be checked on the Windows PC.
- **Default AI:** Bonsai 2 27B on PrismML's own build of llama.cpp (`llama-server`). Stock llama.cpp and Ollama can't run it. Ollama and LM Studio work through the same OpenAI-style adapter, for other models.
