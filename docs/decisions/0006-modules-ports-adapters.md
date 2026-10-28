# 0006 — Feature modules, ports and adapters, one shared contract

**Status:** Accepted (28 Oct 2026)

## Context
The app must stay easy to change as it grows: new job sites, a different AI, email, exports. Coupling is the usual way small apps become hard to maintain. That's when one part reaches into another's data or knows about the web framework.

## Decision
- **Feature modules:** the server is split by feature. Each module owns its tables and exposes only `index.ts`.
- **Talking between modules:** modules call each other's public services, or react to typed events. They never read each other's tables.
- **No framework inside the logic:** services know nothing about HTTP (Fastify) or SQL. Those stay in `routes.ts` and `repo.ts`.
- **Ports and adapters:** outside systems (the AI server, the AI process, mail, exporters, job sites) sit behind small interfaces with swappable adapters.
- **One contract:** `shared/contracts` holds zod schemas for every request and response. The server, dashboard and extension all use them.
- **One composition root:** `server/app.ts` wires everything by hand.
- **Enforced:** a dependency-cruiser config checks the rules on every test run.

## Other options considered
- **Layered folders** (`routes/`, `services/`, `repos/`). Familiar, but a feature's code is spread across folders, and cross-feature reaching is easy.
- **A dependency-injection framework.** Not needed at this size. Manual wiring is clearer.
- **Microservices.** Far too much for a personal app.

## Consequences
- Each feature can be read, tested and changed on its own. Swapping an outside system means writing one adapter.
- There's a little more ceremony per module (four small files), plus a central event map to keep up to date.
