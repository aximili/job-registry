# Windows runbook (for Bonsai 2)

You are checking Job Registry on this Windows PC. Follow the steps in order. Read one step, do it, then read the next.

Each step has:
- **Run:** the exact command. Type it in the PowerShell terminal, in the app folder, and wait until it ends.
- **Expect:** what a good result looks like.
- **If not:** what to do instead.

The check scripts print lines that start with `PASS`, `FAIL` or `INFO`. `INFO` is never a problem. Each script ends with a line like `prereqs: all PASS.` or `prereqs: 2 FAIL. …`. Every line is also kept in `handover-results\results.txt`.

**Keeping your place:** after each step, run `Add-Content handover-results\progress.txt "Step N done"`, with N the step's number. If you're ever unsure where you are, run `Get-Content handover-results\progress.txt` and carry on with the step after the last one done.

## The rules

**You may only make these fixes, and only when a step's "If not" sends you here. Make each one at most once per step:**
- **F1.** A folder that a message says is missing, inside `handover-results\` or the test copy (`%USERPROFILE%\JobRegistryTest`): run `mkdir -Force <that folder>`, then run the step again.
- **F2.** A test port in use (a FAIL with "something already answers" or "the test port"): run `node scripts\handover\cleanup.ts`, then `Start-Sleep -Seconds 10`, then run the step again.
- **F3.** A broken test copy (a FAIL with "Couldn't empty the old test copy", or one about the test copy's settings): run `node scripts\handover\cleanup.ts`, then step 4 again, then the step you were on.
- **F4.** A timeout or network error ("timed out", "ETIMEDOUT", "ECONNRESET", "fetch failed", "network"): run the same step once more.

**Never do any of these:**
- Never change, move or delete:
  - `data\`, `config\`, `profile\`, `templates\` or `ai\`
  - any test, or what a test expects
  - any source file, script or setting: `server\`, `shared\`, `web\`, `extension\`, `scripts\`, `tests\`, `docs\`, `package.json`, `package-lock.json`, and the `.bat` and `.ps1` files.
- Never run `npm`, `npx` or any `.bat` file yourself. The check scripts run them.
- Never run Git commands that change anything: `add`, `commit`, `push`, `pull`, `checkout`, `reset`, `stash`, `clean`, `merge`, `rebase`.
- Never install software. Never change the execution policy, environment variables or Windows settings. Never sign in anywhere, and never type a password.
- Never delete anything yourself. The scripts delete only what they made.
- You only ever create or edit files inside `handover-results\`.

**When a step fails** and none of F1 to F4 fits, or the fix didn't help:
1. Write one bug file per FAIL line, in `handover-results\bugs\`: `bug-01.md`, `bug-02.md` and so on. Use the format in [bug-report.md](bug-report.md).
2. Go on to the next step, unless the step says **STOP**.

**STOP** means: write the bugs, then do steps 11, 12 and 13, and end.

---

## Step 1: Find the app folder

- **Run:** `Test-Path .\package.json`
- **Expect:** `True`.
- **If not:** you're in the wrong folder. The app folder has `package.json`, `start.bat` and `docs\handover\` in it. If you can't find it, tell the user "I can't find the Job Registry folder" and end.

## Step 2: Make the results folders

- **Run:** `mkdir -Force handover-results\bugs`
- **Expect:** no error. If `handover-results\progress.txt` already lists steps as done, carry on after the last one.
- **If not:** tell the user what it printed, and end.

## Step 3: Check what the app needs (about 1 minute)

- **Run:** `node scripts\handover\prereqs.ts`
- **Expect:** `prereqs: all PASS.`
- **If not:**
  - A FAIL on a port: F2.
  - Every other FAIL is for the user: write a bug for each one, with **Type: needs you**.
  - STOP if any of these FAILed: "Node.js 24 or later", "npm works", "Git works". Otherwise go on. A FAIL about the AI is no reason to stop: step 6 deals with it.

## Step 4: Make the test copy (5 to 15 minutes)

The checks that start and stop the app use a copy of it, in `%USERPROFILE%\JobRegistryTest`. So the user's own jobs, settings and profile are never touched.

- **Run:** `node scripts\handover\make-test-copy.ts`
- **Expect:** `make-test-copy: all PASS.`
- **If not:**
  - "wasn't made by the handover checks": someone else's folder has that name. Write a bug with **Type: needs you** and STOP.
  - "Couldn't empty the old test copy": F3.
  - A network error: F4.
  - Anything else: write a bug and STOP.

## Step 5: Start, check and stop the app in the test copy (3 to 10 minutes)

This uses `start.bat`, `setup.bat` and `stop.bat` themselves.

- **Run:** `node scripts\handover\app-smoke.ts`
- **Expect:** `app-smoke: all PASS.`
- **If not:** "the test port is free" is F2. For anything else, write a bug for each FAIL and go on.

## Step 6: The AI in the test copy (5 to 25 minutes)

The test copy uses the AI that the user's settings use (Settings → AI). The line `INFO the AI used` says which:
- **"your own AI server at …"**: a server the user runs, such as the Bonsai 2 you run on (port 8080). This includes a Bonsai 2 the app opens with the user's own .bat file. The test copy uses it, and checks that the app leaves it running. About 5 to 10 minutes.
- **"Bonsai 2 started by the app …"**: the test copy starts its own small llama-server on port 8081, so the Bonsai 2 you run on (port 8080) is never stopped. It needs about 9 GB of free graphics memory. About 15 to 25 minutes.

- **Run:** `node scripts\handover\ai-smoke.ts`
- **Expect:** `ai-smoke: all PASS.`
- **If not:**
  - "the test ports are free": F2.
  - "your AI server answers", "there is room on the graphics card" or "the AI is downloaded": write a bug with **Type: needs you**, then go to step 8 (skip step 7).
  - Anything else: write a bug for each FAIL, run `node scripts\handover\cleanup.ts`, and go on.

## Step 7: How well Bonsai 2 reads ads (a report, not a test; about 5 minutes)

It needs step 6 first, which gives the test copy its AI settings.

- **Run:** `node scripts\handover\eval-report.ts`
- **Expect:** `eval-report: all PASS.` The report is `handover-results\eval-report.txt`. You don't judge it: the user and Claude read it.
- **If not:** write a bug and go on.

## Step 8: The app's own tests in the test copy (20 to 40 minutes)

This runs `npm test`, Mozilla's extension checks, then the browser tests in Firefox and Chromium.

- **Run:** `node scripts\handover\run-tests.ts`
- **Expect:** `run-tests: all PASS.`
- **If not:** run the step once more. Some browser tests depend on timing, and one is known to fail now and then on a busy PC.
  - If it passes the second time, write a bug with **Type: flaky**. Copy the "Failed:" part of the first FAIL line into it.
  - If it fails again, write a bug. Copy the whole FAIL line (it names the failed tests and the log) into **Actual**.
  - Never change a test.

## Step 9: Sign the Firefox extension (about 10 minutes, or nothing)

- **Run:** `node scripts\handover\sign.ts`
- **Expect:** `sign: all PASS.` With no keys set, it says `INFO not signed - no addons.mozilla.org keys`, which is fine.
- **If not:** F4 on a timeout. Otherwise write a bug.

## Step 10: Check the user's own install (read-only; about 1 minute)

This only reads. Its two requests are the app's own Test connection buttons: Gmail's only logs in, and the AI's asks one short question.

- **Run:** `node scripts\handover\real-checks.ts`
- **Expect:** `real-checks: all PASS.`
- **If not:** most FAILs here mean a step in the user's list isn't done yet: the master profile, setup.bat's shortcut, pointing Settings → AI at the user's Bonsai 2 ("the app's AI answers"), or starting the app with email on. Write each of those as a bug with **Type: needs you**. A FAIL on "Gmail answers" or "the last Gmail check worked" is a **bug**, with the exact message.

## Step 11: Stop everything the checks started

- **Run:** `node scripts\handover\cleanup.ts`
- **Expect:** `cleanup: all PASS.`
- **If not:** write a bug.

## Step 12: Collect the logs

- **Run:** `node scripts\handover\collect-logs.ts`
- **Expect:** `collect-logs: all PASS.` There's a new `handover-results\logs-<date>\` folder.
- **If not:** write a bug.

## Step 13: Write the summary, and end

- **Run:** `node scripts\handover\summary.ts`
- **Expect:** `Wrote …\handover-results\summary.md`.
- Then tell the user: "Done. Please bring the handover-results folder back to Claude." End.

---

## Where each Windows check from Phases 1 to 7 is covered

"You" is the user's [optional 15-minute check](do-by-hand.md#your-15-minute-check-optional-after-the-runbook).

| Checklist | Covered by |
|-----------|------------|
| **Phase 1** | |
| Setup, the Desktop shortcut | The user runs setup.bat (do-by-hand); step 4 (`setup.bat -Quiet`); step 10 (the shortcut is there) |
| Start at log-in | Step 10 says on or off. Not covered: signing out and back in |
| Starting and stopping, start.bat when already running, stop.bat when not running | Step 5 |
| A broken settings file, in plain characters | Step 5 |
| The recruiter-call test: a job found by part of a phone number in under 2 seconds, and by company | Step 5, and the browser tests in step 8 |
| A phone number pasted from Outlook or Teams | Step 5 (written as +61); not covered: other odd spaces from Teams |
| Keyboard: S, Esc on the status list, the same person twice | The browser tests in step 8 (Firefox) |
| `/` and Ctrl+K in Firefox, pasting a link | The browser tests in step 8 (Firefox; they check where the focus goes, not that Firefox's own find bar stays shut) |
| setup.bat while the app runs, and run again later keeping your jobs | Step 5 |
| **Phase 2** | |
| setup.bat offers the download, download-ai.bat finishes | The user (do-by-hand). With the app's own Bonsai 2, step 6 checks the model's SHA-256. Not covered with the user's own Bonsai 2: nothing is downloaded |
| Resuming a download, download-ai.bat while the app runs | Not covered: either would fetch 8 GB again |
| Test connection, reading an ad (in 60 seconds at most; the goal is about 20), the AI pill | Step 6; Test connection on the user's own install: step 10 (the pill: the browser tests in step 8, with the fake AI) |
| A llama-server you started is left alone | Step 6, with either AI |
| llama-server's log names CUDA, the idle stop, graphics memory freed, stop.bat and a killed app stop it | Step 6, only with the app's own Bonsai 2. Not covered with the user's own Bonsai 2, which the app never starts or stops. Not covered either way: "no extra console window" (it can't be seen from a script) |
| Match ratings | Step 6 (against a sample profile) |
| The AI not installed, old jobs read after an update, a new job goes first | The unit tests in step 8; step 5 checks a job waits with the reason when the AI can't be reached |
| Ollama and LM Studio | Not covered: optional, only if you use them |
| Reading quality on real ads | Step 7 (on the three sample ads; no real ones were added) |
| **Phase 3** | |
| Mozilla's checks, signing | Steps 8 and 9 |
| Temporary install in Firefox, the permission, Allow access, Alt+Shift+J, Tab to the panel, reloading the extension, a first rating while the AI is off (Firefox) | You (installing the extension and opening a job); not covered in Firefox beyond that |
| Seek, LinkedIn and Indeed while signed in: the panel, Save, quick clicks through results, "Same job?" | You (one job per site); not covered: the quick clicks and "Same job?" on the real sites |
| The panel, the popup, offline, quick clicks with one rating, on copies of the sites (Chromium) | The extension's browser tests in step 8. Not covered there: the options page |
| **Phase 4** | |
| Starter guides and templates; a guide edited on disk | Step 5 |
| Attachments with accents and emoji, a file over 15 MB, backups of files, profile and templates | Step 5. Not covered: that a second backup keeps file dates |
| Bonsai writing a resume (time, no thinking text, the fact-check list), the .docx export | Step 6 (on the sample profile; reading it for invented facts is for you) |
| Stop and closing the tab mid-draft, sent versions never change, unsaved text kept | The browser tests in step 8 (with the fake AI) |
| Firefox's Save to PDF, the .docx in Word for the web | You |
| **Phase 5** | |
| A real Gmail login, the password never sent back, the last check without an error | Step 10 |
| A wrong app password, the first check's time, nothing marked read, Confirm on a real card, the 30-minute timer, Bonsai reading real emails | You (the Gmail item). Not covered by a script: they need your real mailbox |
| Nothing kept but summaries, the AI off mid-check, stopping during a check | The unit tests in step 8 |
| **Phase 6** | |
| The board's drag and drop and Move, follow-ups, Escape and focus | The browser tests in step 8 (Firefox and Chromium) |
| The Windows date picker, a touchpad, a follow-up across midnight | You |
| NVDA, Firefox's resist-fingerprinting mode, a tab left open overnight, dragging to a column off screen, 50 or more jobs | Not covered: optional, rare, or a judgement call |
| **Phase 7** | |
| Bonsai 2's time per card | Step 6 (one card, from the sample ad, against the sample profile) |
| Marks on real signed-in lists on Seek, LinkedIn and Indeed, scrolling, no card with two marks, opening and saving a job from a list | You (one search list per site, and one job opened from a Seek list) |
| Saved cards, a new search, the app stopping, two tabs, the option off | The unit tests and the extension's browser tests in step 8 (on copies of the sites, Chromium). Not covered on the real sites |
| Seek redrawing a card, the tooltips, how the marks look under each site's titles, dark mode, LinkedIn signed out, a minimised Firefox | Not covered: a judgement call, or it needs your signed-in browser |
