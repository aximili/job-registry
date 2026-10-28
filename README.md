# Job Registry

Keeps track of every job you apply for, on your own computer. Save a job by pasting its link or the ad text. Track its status, notes and the people you talk to. When a recruiter calls, find the job in a couple of seconds.

Everything stays on this PC. Nothing is sent anywhere.

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
   - offer to start the app when you log in, so it's ready when a recruiter rings.

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

## Where your data lives

| What | Where |
|------|-------|
| Jobs, people, notes and calls | `data\jobs.db` |
| Backups | `data\backups\` |
| Logs | `data\logs\` |
| Settings | `config\settings.json` |

**Backups:**
- The app makes a backup each time it starts, and once a day while it runs. It keeps the newest 14.
- You can make one any time: **Settings → Back up now**.
- To keep copies off this PC, point the backup folder at OneDrive. In `config\settings.json`, set `"backups": { "dir": "C:/Users/you/OneDrive/Job Registry backups", "keep": 14 }`.
- Keep `data\jobs.db` itself out of OneDrive, because syncing a live database can damage it.

**Statuses:** rename, reorder or add them in **Settings**.

## Updating

Stop the app with `stop.bat` before you run `setup.bat` again. Setup can't replace files the running app is using.

## If something goes wrong

- **The server didn't start:** `start.bat` shows the reason. The full details are in `data\logs\`.
- **A mistake in `config\settings.json`:** the app won't start until it's fixed, and it never overwrites your file. In paths, use `/` or `\\`, because a single `\` breaks JSON.
- **Search seems out of date:** go to **Settings → Rebuild search index**.

## For developers

See [CLAUDE.md](CLAUDE.md) and [docs/](docs/). Key commands:
- `npm test`
- `npm run test:e2e`
- `npm run dev:server` together with `npm run dev:web`
