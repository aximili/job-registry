# 0002 — A local web app, not a desktop app

**Status:** Accepted (28 Oct 2026)

## Context
The app runs on one Windows PC. It must be quick to open while a recruiter is talking, and simple to start.

## Decision
A local Node server on `127.0.0.1:4777` serves the dashboard to a normal browser tab. `start.bat` starts it, and an optional login auto-start keeps it running.

## Other options considered
- **Electron.** A real window and a tray icon, but a large download, more moving parts and its own update story.
- **Tauri.** Smaller, but it needs Rust in the toolchain and adds build complexity on Windows.

## Consequences
- No installer and no packaging. The dashboard is just a tab you can pin.
- The extension and dashboard talk to the same server.
- There's no true Windows-wide hotkey without help. Phase 6 adds one through the Desktop shortcut's "Shortcut key" setting.
- Phone access later is easy, because it's already a web app.
