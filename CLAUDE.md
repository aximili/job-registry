# Job Registry

A personal, local-first app for tracking job applications. It runs on Windows: a Node server, a browser dashboard, a Firefox/Chrome extension, SQLite and a local AI.

## Read these first

1. [docs/plan.md](docs/plan.md): what we're building, the phases, and what "done" means for each phase.
2. [docs/architecture.md](docs/architecture.md): how it's built, covering modules, events, ports and adapters, data model, API and testing.
3. [docs/decisions/](docs/decisions/): why each key choice was made.

If the code and these documents disagree, stop and ask. Don't quietly follow one of them. If a change alters the design, update architecture.md (and §4.2 if dependencies change) in the same piece of work.

## Current status

- **Phase 0** (architecture document): approved 28 Oct 2026.
- **Phase 1** (core registry): built and tested on macOS on 28 Oct 2026 ([plan](docs/superpowers/plans/2026-10-28-phase-1-core-registry.md)). Waiting for the Windows checklist in [docs/checklists/phase-1-windows.md](docs/checklists/phase-1-windows.md).
- **Phases 2–6:** not started.
- **Notes for Phase 2:**
  - The `enrich` module needs a start-up sweep for jobs whose `parseState` is `pending`. Phase 1 marks every job that has ad text as pending, and no AI has run yet.
  - The known minor follow-ups from the Phase 1 review are listed at the end of the Phase 1 plan's ledger. Ask the user before acting on them.

Update this section when a phase starts or finishes.

## Commands

| Command | What it does |
|---------|--------------|
| `npm test` | Typecheck (tsc and svelte-check), then the architecture check (`check:deps`), then the unit and API tests (Vitest). |
| `npm run test:e2e` | Build the dashboard, then run the browser tests (Playwright, in Firefox and Chromium). It starts its own server on port 4799. |
| `npm run dev:server` + `npm run dev:web` | Development mode. The server runs on 4777, and the dashboard on 5173 with live reload. |
| `npm run build` | Build the dashboard into `web/dist` (the server serves it). |
| `npm start` | Run the server (`node server/main.ts`). |

**Windows scripts:** `setup.bat`, `start.bat` and `stop.bat`, plus `scripts/setup.ps1`, must stay plain ASCII with CRLF line endings (`.gitattributes` enforces CRLF). Windows PowerShell 5.1 misreads UTF-8 that has no byte-order mark.

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
