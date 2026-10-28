# 0001 — Node.js and TypeScript for everything

**Status:** Accepted (28 Oct 2026)

## Context
The app has three parts: a local server, a dashboard and a browser extension. The extension and dashboard must be JavaScript. The server could be Node.js or Python.

## Decision
Use TypeScript for all three. Node.js LTS runs the server's `.ts` files directly, using built-in type stripping, so the server has no compile step. Use erasable syntax only: no `enum`, no constructor parameter properties.

## Other options considered
- **Python (FastAPI) server.** Good libraries, but two languages and two toolchains. Types can't be shared between the server and its clients.
- **Plain JavaScript.** Simpler tooling, but no compile-time check that the server and clients agree on the API.

## Consequences
- One language and one `npm install`. The API types are shared by all three parts (see [0006](0006-modules-ports-adapters.md)).
- Node must be a supported LTS version, because `better-sqlite3` needs a matching prebuilt binary. Setup checks this.
