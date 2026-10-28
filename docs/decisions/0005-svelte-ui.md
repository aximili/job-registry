# 0005 — Svelte 5 for the dashboard and the extension's UI

**Status:** Accepted (28 Oct 2026)

## Context
The dashboard needs instant search, inline editing, dialogs and a live document preview. The extension needs a small popup and a floating panel. Both should be quick to build and easy to read later.

## Decision
- **Svelte 5:** used for the dashboard, built with Vite, and for the extension's popup and panel, built with esbuild and `esbuild-svelte`.
- **No global state library:** pages fetch what they need, and they react to live events.

## Other options considered
- **React.** The most widely known, but more boilerplate, and a bigger bundle for the content-script panel.
- **No framework (htmx, Alpine or plain TypeScript).** The smallest footprint, but the editor, dialogs and keyboard navigation get messy without components.

## Consequences
- Components are short and readable. One UI framework is used across the whole app.
- The dashboard needs a build step, which setup runs once. The server serves the built files.
