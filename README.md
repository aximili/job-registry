# Job Registry

Keeps track of every job you apply for, on your own computer. Save a job by pasting its link or the ad text. Track its status, notes and the people you talk to. When a recruiter calls, find the job in a couple of seconds. A local AI reads each ad you save, fills in the details, and rates how well the job fits you.

Everything stays on this PC, including the AI. Nothing is sent anywhere.

## First-time setup (Windows)

1. **Install Node.js** (version 24 or later). Open a terminal and run:
   ```
   winget install OpenJS.NodeJS.LTS
   ```
2. **Run `setup.bat`** (double-click it). It will:
   - install what the app needs
   - build the dashboard
   - create your settings file
   - offer to make a Desktop shortcut
   - offer to start the app when you log in, so it's ready when a recruiter rings
   - offer to download the AI (about 8 GB). You can do this later with `download-ai.bat`.

## Every day

- **Start:** double-click `start.bat` or the Desktop shortcut. The dashboard opens in your browser at http://127.0.0.1:4777/. If the app is already running, it just opens the dashboard.
- **Stop:** double-click `stop.bat`, or close the minimised "Job Registry server" window.

### When a recruiter calls

The cursor is already in the search box. Type a few letters of the company, the recruiter's name, or any part of their phone number. Press Enter to open the job's call sheet.

### Keys

| Key | What it does |
|-----|--------------|
| `/` or `Ctrl+K` | Jump to search |
| `↑` `↓` `Enter` | Move through results and open one |
| `Esc` | Clear the search, or go back to the list |
| `N` | New job (or paste a link or ad text anywhere outside a text box) |
| `L` | Log a call (on a job) |
| `S` | Change status (on a job) |
| `E` | Edit the job's details |
| `Ctrl+Enter` | Save a note or a call |

## The AI

When you save a job, the app saves it straight away. Then the AI reads the ad in the background and fills in the details you left empty: role, company, salary, location, requirements and so on. It never changes a field you typed or edited. If you've added your master profile, it also rates the match.

- **The pill in the header** shows what the AI is doing: off, starting, ready, working, or a problem. Click it to go to the AI settings.
- **The AI starts when it's needed** and stops after 15 idle minutes, to free your graphics card's memory for other apps.
- **If the AI can't be reached**, your job is still saved. It says why, and it's read the next time the AI works (when another job is read, or you press **Test connection**), or at the next start. **Read again** on the job tries straight away.
- **Match ratings** need your master profile: put it in `profile\master-profile.md`. Optional: `profile\preferences.md`, with the roles you want, your salary floor, locations, work mode and deal-breakers.

### Choosing the AI

Go to **Settings → AI**, pick the AI server, then press **Test connection**.

- **Bonsai 2 (the default):** the app starts and stops PrismML's llama-server for you. Run `download-ai.bat` once to get it (about 8 GB, for an NVIDIA graphics card). If a download stops, run it again: it carries on.
- **Ollama or LM Studio:** start it yourself, pick it in Settings, and type the model's name in **Model** (for example `qwen3:8b`). Nothing else changes.
- **Another OpenAI-style server:** pick "Another OpenAI-style server" and enter its address, which usually ends in `/v1`.

Advanced settings, such as the model for each task or extra request fields, are in `config\settings.json` under `"ai"`. If a server refuses a field, for example `reasoning_effort`, remove it for a task with `"extra": { "reasoning_effort": null }`.

## The browser extension

On Seek, LinkedIn and Indeed job pages (including the search pages with a job open on the right), a small panel shows:
- whether you've saved the job already ("Saved · Applied 12 Oct"), with a link to it
- or **Save**, with a status and an optional note: one click
- "Looks like … Same job?" when it may be a job you saved from another site
- how well the job fits you, if you've added your master profile.

The toolbar button (or `Alt+Shift+J`) saves a job ad from any other website. To install it in Firefox or Chrome, see [extension/README.md](extension/README.md).

## Where your data lives

| What | Where |
|------|-------|
| Jobs, people, notes and calls | `data\jobs.db` |
| Backups | `data\backups\` |
| Logs | `data\logs\` |
| Settings | `config\settings.json` |

**Backups:**
- The app makes a backup each time it starts, and once a day while it runs. It keeps the newest backup from each of the last 14 days it made one.
- You can make one any time: **Settings → Back up now**.
- To keep copies off this PC, point the backup folder at OneDrive. In `config\settings.json`, set `"backups": { "dir": "C:/Users/you/OneDrive/Job Registry backups", "keep": 14 }`.
- Keep `data\jobs.db` itself out of OneDrive, because syncing a live database can damage it.

**Statuses:** rename, reorder or add them in **Settings**.

## Updating

Stop the app with `stop.bat` before you run `setup.bat` or `download-ai.bat` again. They can't replace files the running app is using, and they tell you if it's still running.

After you update to a version with the AI, the app reads your saved jobs' ads in the background, one at a time. A job you save meanwhile goes first.

## If something goes wrong

- **The server didn't start:** `start.bat` shows the reason. The full details are in `data\logs\`.
- **A mistake in `config\settings.json`:** the app won't start until it's fixed, and it never overwrites your file. In paths, use `/` or `\\`, because a single `\` breaks JSON.
- **Search seems out of date:** go to **Settings → Rebuild search index**.
- **The AI pill says "AI problem":** click it. Settings → AI says what's wrong ("Right now: …"), and **Test connection** checks again. llama-server's own log is `data\logs\llama.log`.

## For developers

See [CLAUDE.md](CLAUDE.md) and [docs/](docs/). Key commands:
- `npm test`
- `npm run test:e2e`
- `npm run dev:server` together with `npm run dev:web`
- `npm run ext:build`, `npm run ext:lint`, `npm run ext:sign`, `npm run ext:check -- page.html URL`: the browser extension. See [extension/README.md](extension/README.md).
- `npm run eval:parse`: how well the AI in your settings reads job ads. See [tests/fixtures/ads/README.md](tests/fixtures/ads/README.md) to add real ads.
