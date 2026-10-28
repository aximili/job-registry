# 0009 — The extension reads job pages, not the server

**Status:** Accepted (28 Oct 2026)

## Context
Seek, LinkedIn and Indeed often block a server that tries to download their pages, and LinkedIn needs you to be signed in. You also want a one-click save and a match rating while browsing.

## Decision
- **Where pages are read:** the browser extension reads the job page you have open, using one small extractor per site plus a generic fallback, and sends the text to the server. The server's own URL fetching is only a fallback for pasted links, and it says so when a site blocks it.
- **Only pages you open:** the extension never crawls or opens pages by itself.

## Other options considered
- **Server-side fetching or scraping.** Often blocked, can't see pages that need a sign-in, and is closer to automated scraping.
- **Paste only.** Always works, but it's slow, and there's no rating while you browse.

## Consequences
- Saving is reliable and quick on the sites you use. The rating can show right on the page.
- Site layouts change, so extractors need occasional fixes. Each site is one small file, with fixture tests.
- Firefox needs the extension signed (unlisted) to keep it installed after a restart.
