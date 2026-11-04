# Phase 9: Windows checks (better letters, and getting ready for a job)

Input for the Windows handover, not a checklist to tick by hand.

The writing AI, the brief ("Before I write"), "Get ready", the starter-guide update and the contact emails were built and tested on macOS on 3–4 Nov 2026, against fake AIs only: no test ran a real model or sent anything to a real cloud AI. The browser tests ran in Firefox and Chromium on the Mac. These checks need the Windows PC, Windows Firefox, your own Bonsai 2 27B (`start_bonsai.bat`), your real master profile, and (for the Claude checks) a Claude API key.

Before you start: copy `config\settings.json` and the whole `profile\` folder somewhere safe.

## `npm test` on Windows

- **Run it** in PowerShell, in the app folder: `npm test`. It passes.
- **Two checks behave differently on the PC, on purpose:**
  - The "no real names" check in `tests/starter-guides.test.ts` is **skipped**, with a reason, because its list of hashes lives only on the Mac (`.superpowers/real-name-hashes.json`, which git never holds). A skip isn't a failure.
  - The starter-history check (`tests/starter-history.test.ts`) runs only where git is there. In a Git checkout it compares the app's list of earlier guides with `git log` and `git show`. Note whether it ran or was skipped.

## The starter guides after the update

The app now ships a better cover-letter guide, and a resume guide with one line changed. At start-up, a guide that is exactly an earlier starter (one you never changed) is updated, and its old text kept. A guide you changed is left alone, and Settings → Profile offers the new one.

- **The start-up log:** after the first start on the new version, open the newest `data\logs\app-*.log`. If your guide was an untouched earlier starter, it has a line "Updated the starter guide: cover-letter-guide" (or `resume-guide`, or both). Note which. A line "Couldn't add or update the starter file …" is a bug: copy it into the results.
- **The old copy:** if a guide was updated, `profile\old-versions\` holds its old text, named like `cover-letter-guide-2026-11-04-093015.md` (the date and time of the start, local time). Open it: it's your old guide, exactly. Run `Get-ChildItem profile\old-versions` and copy the list into the results.
- **Line endings didn't block it:** Git for Windows checks `.md` files out with Windows line endings, so your copy of an old starter may have them. That must still count as unchanged. If your guide was never edited but there's no "Updated" line, it's a bug: note it, and copy the guide's first three lines.
- **The note, for a guide you changed:** open **Settings → Profile**. For a guide you've edited, a note says "A newer starter guide is ready." Press **See what changes**: removed lines are marked `−`, added lines `+`, and long runs of unchanged lines are folded. It reads well in Light and Dark.
  - **Keep mine:** press it on one guide. The note goes. Reload the page: it stays gone.
  - **Use the new guide** (on the other guide, or after copying yours somewhere safe): the editor shows the new guide, and the toast says "Now using the new cover letter guide. Your old one is kept in the profile folder, under old-versions." A new file is in `profile\old-versions\`, with your old text in it.
  - If neither guide shows the note, both were the same as the new starters, or were updated at start-up. Note which.
- **Windows file names:** every name in `profile\old-versions\` opens in Notepad and in File Explorer, with no odd characters. Two changes in the same second get `-2` on the second name.
- **Backups:** after the next backup (**Settings → Back up now**), the backup folder's `profile\old-versions\` holds the same files.

## Pick a writing AI (after the Claude key is in)

Do this after the Phase 8 checks have saved "Claude – mine" with a real key.

- **The setting:** in **Settings → AI**, above My AIs, **Writes your documents** shows "The AI in use (Bonsai 2)". Its help line says that ratings, quick marks, reading ads and reading emails stay on the AI in use.
- **Pick Claude – mine:** choose it in the list. Within half a second the toast says "Claude – mine writes your documents now." The AI pill still says Bonsai 2. Reload the page: it's still picked. `config\settings.json` has `"writer": "claude-mine"` under `"ai"`.
- **By keyboard:** Tab to the list and type a letter, or open it with Alt+↓ and pick with Enter. Arrowing through the closed list saves once, for the last choice (one toast). Note anything odd.
- **Ratings stay on Bonsai 2:** open a job page with the extension. The rating comes from Bonsai 2 (Claude's usage page shows no new request for it). Stay off search lists while you test, as before.
- **Back to the AI in use:** pick "The AI in use (Bonsai 2)". The toast says "The AI in use writes your documents now."
- **The task rows:** Bonsai 2's form has "Making the brief" (Medium, 3072, 0.3) and "Making the prep plan" (Low, 4096, 0.4) among the task rows.

## A brief and a plan on Bonsai 2 27B, with your real profile

The goal: a brief and a plan each take about as long as a rating. Bonsai 2 does the writing here: the writer is "The AI in use (Bonsai 2)".

- **Make a brief:** on a real saved job with an ad, open **New cover letter**. Press **Write the cover letter**. The progress line says "Waiting for Bonsai 2…", then "Bonsai 2 is making the brief… 0:12" and counts up. Note the time when the brief shows, and the time a rating took on the same job.
  - It never says "out of room" or "too long". If it does, copy the whole sentence into the results.
  - Firefox doesn't give up while Bonsai 2 thinks quietly: even after a minute or more, the brief arrives (the server sends a line every 20 seconds).
- **Read the brief:** **Contact** has a name when the ad gives one. The **Opening line** is a real line from the ad (if it isn't, it says "This line isn't word for word in the ad. Check it."). Each **Need** has a story from your profile, with no invented employer, number or claim. **Gaps** names only must-haves your profile lacks. **Questions** asks only what your profile doesn't already say. Note anything invented or wrong.
- **Change it:** swap one need's story, drop a need, answer one question and skip another, and tick **Add to my profile** on your answer. Each change saves at once: reload the page and they're all still there.
- **Write with it:** press **Write the cover letter**. The toast says "Added 1 answer to your master profile." The letter follows the brief: it writes to the contact, opens with the brief's line, and tells the stories you kept. Note the time it took, and whether it ended "ran out of room".
- **Your profile gained one line:** open **Settings → Profile → Master profile**. At the end, under `## Answers from my applications`, there's one line like `- 4 Nov 2026, {role} at {company}: {question} {answer}`. Nothing else changed. `profile\old-versions\` has a copy of the profile from just before (`master-profile-…md`). Write again with the same brief: no second line is added.
- **Get ready:** on the job page, press **Get ready**. The progress line says "Bonsai 2 is making your plan… 0:15". Note the time. The plan has its five parts. It has no links or web addresses, and nothing about the employer the ad doesn't say. Press **New plan**: the first one moves under **Earlier plans**, by date.
- **Cancel:** press **Show the brief**, then **New brief**, then **Cancel** while it works. It stops at once, and after a reload the old brief is still the job's brief, with your answers. Bonsai 2's window shows the request stopping.

## A letter with a brief on Claude

- **Pick Claude – mine** to write (beside the button, **Change the writing AI**, or in Settings → AI). The writer line says "Writes with Claude – mine".
- **On the same job,** press **Show the brief**, then **New brief**, then write the cover letter. Note both times. The progress lines name Claude – mine, and the AI pill stays on Bonsai 2 the whole time.
- **Ratings don't wait:** while Claude writes, open a job page in another tab. Its rating from Bonsai 2 comes without waiting for the letter.
- **Compare the two letters** (Bonsai 2's and Claude's), side by side. Note which reads better, and anything either invented.
- **A problem stays where you write:** on Claude – mine, press **Replace**, paste the key with an `x` at the end, and save. Write again: the editor says "Claude – mine refused its API key. Check the key in Settings → AI." The pill still says "Bonsai 2 · ready". Put the right key back.
- **The bill:** note what the brief, the letter and a plan cost in the Claude Console's usage page.
- Pick "The AI in use (Bonsai 2)" again when you're done, unless you want Claude to keep writing.

## A Seek ad with a hidden email

- **Find a Seek ad** whose contact shows as "••••@…" (a masked email), signed in or out.
- **Save it** from the panel. Open the job in the dashboard: the saved ad text has the address in brackets after the masked one, such as "••••@example.com.au (alex@example.com.au)".
- **The contact fills in:** once the AI has read the ad, the job's contact has that email, and a name when the email gives a first name. Note what it shows.
- **The brief uses it:** make a brief for that job. **Contact** shows the email, and the letter starts "Dear Alex," (the first name from the email).

## Writing AI on this computer that isn't in use (optional)

Only if you have a second local AI (say Ollama, or a second Bonsai .bat file on another port).

- Pick it to write while Bonsai 2 is in use, with it **not** running. Write a letter: the editor says "Can't reach {name} at {address}. …", and no window opens for it. The app never starts or stops a writing AI that isn't the AI in use.
- Start it yourself, and write again: it works. Note the time.
