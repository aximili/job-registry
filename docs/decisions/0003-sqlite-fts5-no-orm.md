# 0003 — SQLite with FTS5, plain SQL, no ORM

**Status:** Accepted (28 Oct 2026)

## Context
A single user with a few thousand rows at most. Search must be instant across companies, people, phone numbers, notes and ad text.

## Decision
- **Database:** SQLite through `better-sqlite3` (synchronous, fast, prebuilt for Windows), in WAL mode with foreign keys on.
- **Search:** one FTS5 table, with phone numbers searched separately on a normalised digits column.
- **SQL:** plain SQL in each module's `repo.ts`.
- **Schema changes:** numbered SQL migration files.

## Other options considered
- **Node's built-in `node:sqlite`.** No native module, but it's still marked as a release candidate, and full-text search support depends on how Node was built.
- **An ORM (Prisma, Drizzle).** Adds a layer, code generation and its own migration tool, which is overkill for about 12 tables.
- **A server database (Postgres).** Needs installing and running, which works against "simple to run".

## Consequences
- The whole database is one file that's easy to back up. Search takes milliseconds.
- SQL stays in one file per module, which keeps it easy to find and review.
- If `node:sqlite` becomes stable, only `core/db` and the repos would change.
