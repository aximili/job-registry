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
| `F` | Follow up: set the day to chase this job (on a job) |
| `Ctrl+Enter` | Save a note or a call |

## The AI

When you save a job, the app saves it straight away. Then the AI reads the ad in the background and fills in the details you left empty: role, company, salary, location, requirements and so on. It never changes a field you typed or edited. If you've added your master profile, it also rates the match.

- **The pill in the header** shows what the AI is doing: off, starting, ready, working, or a problem. Click it to go to the AI settings.
- **The AI starts when it's needed** and stops after 15 idle minutes, to free your graphics card's memory for other apps.
- **If the AI can't be reached**, your job is still saved. It says why, and it's read the next time the AI works (when another job is read, or you press **Test connection**), or at the next start. **Read again** on the job tries straight away.
- **Match ratings** need your master profile: paste it in **Settings → Profile**. Your preferences are optional: the roles you want, your salary floor, locations, work mode and deal-breakers.

### Choosing the AI

Go to **Settings → AI**, pick the AI server, then press **Test connection**.

- **Bonsai 2 (the default):** the app starts and stops PrismML's llama-server for you. Run `download-ai.bat` once to get it (about 8 GB, for an NVIDIA graphics card). If a download stops, run it again: it carries on.
- **Ollama or LM Studio:** start it yourself, pick it in Settings, and type the model's name in **Model** (for example `qwen3:8b`). Nothing else changes.
- **Another OpenAI-style server:** pick "Another OpenAI-style server" and enter its address, which usually ends in `/v1`.

Advanced settings, such as the model for each task or extra request fields, are in `config\settings.json` under `"ai"`. If a server refuses a field, for example `reasoning_effort`, remove it for a task with `"extra": { "reasoning_effort": null }`.

## Resumes and cover letters

On a job's page, under **Documents**, press **New resume** or **New cover letter**. The editor shows your text on the left and the A4 page on the right.

- **Generate** writes a draft from your master profile, aimed at this job. The text arrives as the AI writes it, and **Stop** keeps what's there so far.
- **The fact-check** looks for numbers, dates, money, percentages and names in the draft. Any your master profile doesn't have are listed ("Not in your profile: 40%") and highlighted in the preview. It never stops you saving or sending, and it can't catch every invented claim, so read each draft yourself.
- **Save version** keeps a new version every time. Nothing is ever overwritten.
- **Mark as sent** freezes that version with the template as it was then. Later template changes never change what you sent, so you can always see it and print it again. The call sheet shows what you sent.
- **Print / PDF** opens the page in a new tab. Press Ctrl+P there, choose **Save to PDF** and A4, and untick **Headers and footers** (under More settings).
- **Export .docx** makes a Word file for agencies that ask for one. Open it in Word for the web, ONLYOFFICE or LibreOffice, which are all free.
- **Start from another job's version** copies a resume or letter you made before.
- **Attach file** keeps a PDF or Word file you made elsewhere with the job, up to 15 MB.
- Text you haven't saved is kept in the browser, so closing the tab doesn't lose it. The editor offers to restore it.

### Your profile

Go to **Settings → Profile**:
- **Master profile:** everything you've done. Paste your full resume, with every job, result and qualification. The AI writes only from this.
- **Preferences:** the roles you want, your salary floor, locations and deal-breakers. They're used for match ratings.
- **Resume guide** and **Cover letter guide:** how you want them written. The app comes with starter guides, which you can change.

**Settings → Templates** holds the CSS that styles the page: `resume.css` and `cover-letter.css`. The files live in the `profile` and `templates` folders, so you can edit them in any text editor too.

## Gmail

The app can read your Gmail inbox and spot emails about your jobs: "thanks for applying", a rejection, an interview invitation, an assessment or an offer. Each one shows as a card in the **Inbox** (the link at the top of the dashboard shows how many are waiting), for example "Rejection · Mark as Rejected?". Nothing changes until you press **Confirm**.

- **Confirm** sets the job's status and adds a note with a one-line summary, so the job's page shows what the email said. You can choose another status first, or "Don't change the status" to only add the note.
- **Pick another job** (or **Pick a job**, when none matched) moves the card to the job the email is really about. **Dismiss** throws the card away.
- **What's read:** only your inbox, every 10 minutes (or as set in **Minutes between checks**) and when you press **Check now**. The first check goes back 14 days. The app never sends, moves, deletes or marks email as read.
- **What's kept:** the sender, subject, date and a short summary of the emails that are about your jobs. Never the email itself. The local AI reads each email on this PC.
- **If the AI can't read emails** (it's off, or refuses them), the check stops and the Inbox says "Waiting for the AI: …". The emails are read when the AI works again.
- **Which emails:** those from your contacts, from a company or agency you've saved a job with, naming one of them, or about an application. Most newsletters and job alerts are skipped, and the AI ignores the rest.

**To connect Gmail:**
1. Turn on 2-Step Verification for your Google account, if it isn't on yet.
2. Make an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Google shows 16 letters.
3. In **Settings → Email**, tick **Check Gmail for emails about your jobs**, enter your Gmail address, paste the app password, and press **Test connection**. That saves them too.

The app password is kept in `config\secrets.json`, which never leaves this PC and is never shown again. Google cancels app passwords when you change your Google password, so make a new one then. If you archive emails before the app reads them, stop the app with `stop.bat`, set `"mailbox"` under `"email"` in `config\settings.json` to `"[Gmail]/All Mail"`, then start it again.

## Follow-ups and the board

**Follow-ups:** on a job, press **Follow up** (or `F`) and pick a day (Tomorrow, In 3 days, In a week, In 2 weeks, or any date), with an optional reason such as "Chase Sam". The home page then lists what's due today or late ("2 days late") and what's coming up in the next week. Press **Done** when you've followed up. Nothing clears a follow-up by itself, not even rejecting or archiving the job.

**The board:** the **Board** link at the top shows a column for each status, with a card for each job. Drag a card to another column to change its status, or choose a status in the card's **Move to** menu and press **Move**. Tick **Show closed statuses** to see Rejected, Withdrawn and No response too. Status changes from the board are kept in the job's history like any other.

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
| Your Gmail app password | `config\secrets.json` |
| Your profile and writing guides | `profile\` |
| Resume and cover letter templates | `templates\` |
| Attached files | `data\files\` |

**Backups:**
- The app makes a backup each time it starts, and once a day while it runs. Your attached files, profile and templates are copied into the backup folder too, in `files`, `profile` and `templates`. Only new and changed files are copied, and nothing there is deleted. It keeps the newest backup from each of the last 14 days it made one.
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
- **The Inbox says Gmail refused the address or app password:** make a new app password (step 2 above) and save it in Settings → Email. "Can't check imap.gmail.com's certificate" means your antivirus scans email: turn that scanning off for this app.
- **The AI pill says "AI problem":** click it. Settings → AI says what's wrong ("Right now: …"), and **Test connection** checks again. llama-server's own log is `data\logs\llama.log`.

## Checking it on Windows

See [docs/handover/](docs/handover/README.md): a short list of what only you can do, and a runbook that Bonsai 2 follows to check everything else, writing any problems into `handover-results\bugs\`.

## For developers

See [CLAUDE.md](CLAUDE.md) and [docs/](docs/). Key commands:
- `npm test`
- `npm run test:e2e`
- `npm run dev:server` together with `npm run dev:web`
- `npm run ext:build`, `npm run ext:lint`, `npm run ext:sign`, `npm run ext:check -- page.html URL`: the browser extension. See [extension/README.md](extension/README.md).
- `npm run eval:parse`: how well the AI in your settings reads job ads. See [tests/fixtures/ads/README.md](tests/fixtures/ads/README.md) to add real ads.
