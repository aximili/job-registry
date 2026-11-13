# What only you can do

The agent tool runs the checks for you (the [runbook](runbook.md)), on your Strata AI. These steps need you, because they install programs, need your passwords or a signed-in browser, or need a person to look. Allow about an hour, mostly waiting for downloads.

## Before Bonsai 2 starts (about 45 minutes)

1. **Install the programs.** In a terminal, run:
   ```
   winget install OpenJS.NodeJS.LTS
   winget install Git.Git
   winget install Mozilla.Firefox
   winget install Microsoft.VisualStudioCode
   ```
   Then close the terminal and open a new one, so it finds them.
2. **Get this version of the app** onto the PC as a Git checkout (one test needs Git).
   - Already have it from Phase 1? Run `stop.bat`, then `git pull` in that folder. Your jobs in `data\` stay.
   - New PC? Clone your repository into a short path without OneDrive, such as `C:\JobRegistry`.
3. **Run `setup.bat`** (double-click it). Answer **Y** to the Desktop shortcut, and your choice to "start when you log in". For "Download the AI":
   - **N** — you run Strata yourself from `F:\CODE\Random\LocalAI\Strata`. The app then uses it (step 8).
   - **Y** only if you want the app to start and stop its own copy of Bonsai 2. That's about 8 GB.
4. **Start Strata:** run `stop.bat` first (if Job Registry is running, it may have started its own AI on port 8080). Then run `F:\CODE\Random\LocalAI\Strata\start-strata-iq2xs.bat`. It stops Ollama first (Ollama competes for the RAM Strata needs), and the first load takes 1 to 3 minutes. Wait until Strata answers on port 8080 (`strata status`). Leave it running the whole time. Strata runs once, on port 8080, for both the agent tool and the app. Stop it with `F:\CODE\Random\LocalAI\Strata\stop-strata.bat`.
5. **The agent tool.** It's the tool that runs your AI (Strata on port 8080, or Bonsai 2) and follows the runbook. Any tool works (yours is KiloCode in VS Code right now; OpenCode, ZCode and others are fine too), if you can set it up like this:
   - **API provider:** OpenAI Compatible, with base URL `http://127.0.0.1:8080/v1`. Any API key and model name work, because llama-server checks neither.
   - **Context window:** the same as your AI gives each request (Strata: 262,144; Bonsai 2 with `start-bonsai-server.bat`: 32,768). No images.
   - **Terminal:** PowerShell, in the app folder (in VS Code: Terminal → Select Default Profile → PowerShell).
   - **Long commands:** it must let one command run for up to 40 minutes (step 8 takes that long). Some tools stop a command after a few minutes: look for a command timeout setting, and raise it.
   - **Approvals:** allow reading files and running commands, but not editing files. Bonsai 2 should only ever edit files in `handover-results\`, so approve only those edits. Stay near the PC: each bug it writes waits for your OK.
6. **Open the app folder** in your agent tool (in VS Code: File → Open Folder → yours is `F:\CODE\VIBE\job-registry`).

## Your own data (10 minutes)

7. **Start the app** with the Desktop shortcut. In **Settings → Profile**, paste your master profile (your full resume) and press **Save**. Add your preferences if you like.
8. **Point the app at Strata** (Settings → AI). This PC is already set up: the saved AI **Strata** uses `http://127.0.0.1:8080/v1`, opens `start-strata-iq2xs.bat` when Strata isn't running, and its Model name is left empty so the app uses whatever model Strata has loaded (IQ2_XS, or IQ3 when you switch). On a new PC, press **Add an AI**, pick **Bonsai 2 (llama-server)**, and set the same fields. Then press **Use this** on Strata in My AIs. The AI pill now says **Strata**.
   - The app never stops Strata, so the idle stop does not apply. Stop it with `stop-strata.bat`.
    - **Thinking quirk:** Strata can't stop thinking when asked to. The saved Strata AI handles this with `chat_template_kwargs` `enable_thinking: false` on the no-thinking tasks (reading ads, quick marks, email). Keep those task settings as they are.
    - **A cloud AI and the runbook:** if a cloud AI is in use when the runbook runs, steps 6 and 7 skip their AI checks (they print SKIP), because the test copy never gets an API key. That's fine. If you want those checks, switch back to Strata or Bonsai 2 first.
9. **Gmail (optional):**
   1. Make an app password at myaccount.google.com/apppasswords (it needs 2-Step Verification).
   2. In **Settings → Email**, tick "Check Gmail…", enter your Gmail address, paste the app password, and press **Test connection**.
10. **Firefox signing (optional):** to keep the extension installed after a restart, get API keys at addons.mozilla.org (Developer Hub → Manage API Keys). Then set them for your user, in a terminal:
   ```
   setx WEB_EXT_API_KEY "user:12345:678"
   setx WEB_EXT_API_SECRET "your secret"
   ```
   Restart your agent tool after that, so it sees them.

## Start the agent tool on the runbook

11. In your agent tool, type: **"Follow docs/handover/runbook.md from Step 1. Read one step at a time, and do every step in order."** It takes about an hour and a half. Approve its edits to files in `handover-results\` when it asks.
12. When it says "Done", bring the `handover-results` folder back to Claude: `summary.md`, `results.txt`, the `bugs` folder and the `logs-…` folder.
13. If it loses its place, tell it: "Run Get-Content handover-results\progress.txt and carry on from the next step of docs/handover/runbook.md." 

## Running the runbook again

After Claude has fixed the bugs from a run:

1. Rename the old `handover-results` folder, for example to `handover-results-1`. The new run then starts clean, and old bugs don't end up in the new summary. Keep the old folder: Claude may ask for it.
2. Get Claude's fixes: in the app folder, run `git pull`.
3. Do any step above that you haven't done yet.
4. In your agent tool, type the same sentence as in step 11.

## How the app and the agent share Strata

- **Strata** (Settings → AI with `start-strata-iq2xs.bat`): the app sends it requests and never stops it, so the agent is never cut off. The app only opens the `.bat` when nothing answers on port 8080. Strata takes one request at a time, so a long task can make you wait for a quick one.
  - While a check script runs, the agent tool waits for it, so the two don't compete.
  - Strata's context is 262,144 tokens, so writing a resume has plenty of room.
- **If you use Bonsai 2 instead** (`start_bonsai.bat` or Another OpenAI-style server): the app sends it requests and never stops it, so the agent is never cut off, and the app only opens `start_bonsai.bat` when nothing answers on port 8080. `start-bonsai-server.bat` uses `-c 65536 -np 2`: two requests at once, each up to 32,768 tokens.
- **Quick marks on search lists** use the same AI. While the agent tool is working, untick "Rate the jobs in search results" in the extension's options, so a search list open in Firefox doesn't keep the AI busy. Tick it again when the agent has finished.

## After the Phase 9 update (about 30 minutes)

Phase 9 adds a writing AI, a brief you check before a letter is written ("Before I write"), "Get ready" for an interview, and a better cover-letter guide. These need your real profile, a local AI (Strata or Bonsai 2 27B), a Claude key and your eyes. The details, with what to note, are in [the Phase 9 checklist](../checklists/phase-9-windows.md).

1. **Back up first:** copy `config\settings.json` and the whole `profile\` folder somewhere safe. Then run `stop.bat`, `git pull` and `setup.bat`, and start the app.
2. **The guides:** open **Settings → Profile**.
   - If you never changed a guide, the app has already updated it. Your old copy is in `profile\old-versions\`.
   - If you did change one, a note says "A newer starter guide is ready." Press **See what changes**, then **Use the new guide** or **Keep mine**. Either way, nothing of yours is lost.
3. **Time a brief and a plan on Bonsai 2 27B,** with your real profile: on a real job, open **New cover letter**, press **Write the cover letter**, and note how long the brief takes. Then check it (swap a story, answer a question), write the letter, and note that time too. On the job page, press **Get ready** and note the time. The goal: a brief and a plan each take about as long as a rating.
4. **Pick a writing AI** once your Claude key is in (Phase 8's checks): **Settings → AI → Writes your documents** → **Claude – mine**. Write the same letter again with Claude, and compare the two. Ratings and quick marks stay on Bonsai 2, so they stay free. To go back, pick "The AI in use (Bonsai 2)".
5. **A Seek ad with a hidden email** ("••••@…"): save one, and check that the job's contact and its brief have the real address.

## Your 15-minute check (optional, after the runbook)

These need a person, a signed-in browser or Word. Skip any you don't care about.

- **The extension:** install the signed `.xpi` from `extension\dist\signed\` in Firefox (or load `extension\dist\firefox\manifest.json` in `about:debugging`). Open one job on Seek, LinkedIn and Indeed while signed in. The panel shows the job and **Save** works.
  - Updated an older copy of the extension? Open `about:addons` → Job Registry → **Permissions**. Check that au.seek.com and nz.seek.com are allowed, and turn them on if not. Firefox may not grant new sites on an update.
  - Then open one search list on each site. Within a minute, the cards on screen get a mark after their title, one card after another (such as "Good 68 · quick"). A job you saved says "Saved". Scroll down: new cards get marks too, and no card has two. About how many seconds does each card take?
  - Open a job from a Seek search list (the split view). Wait for its full rating in the panel: its card's mark changes to the full one (no "· quick"). Then press **Save**: the card says "Saved".
  - Drag the panel by its top bar ("Job Registry"), and make it bigger from its top-left corner. Open another job: the panel is where you left it. Double-click the bar: it goes back to the corner.
  - Open three quite different jobs. Their match scores should differ, not all be 72.
  - Signed in, open Seek's home page (au.seek.com). The cards under "Recommended" get marks too. Click one: the job opens on the side, and the panel shows it. Type a note in the panel, and scroll it with the mouse wheel: both work while Seek's side window is open. Close the side window: the panel goes.
- **Thinking:** Strata can't stop thinking when asked, so task "Off" works only through `chat_template_kwargs` `enable_thinking: false` (already in the saved Strata settings). Check: open a job and its rating comes with thinking; a quick card mark comes without thinking, within a couple of seconds.
  - "Writing resumes and cover letters" should say **No limit** (it does in the saved Strata settings). Strata's context is 262,144, so a resume has plenty of room.
- **Print to PDF:** on a job, make a resume, press **Print / PDF**, then Ctrl+P → Save to PDF. It looks like the preview.
- **.docx:** press **Export .docx** and open it in Word for the web. It looks tidy.
- **Gmail:** after the app has run for 15 minutes with email on, open the Inbox. Do the cards make sense? Were the emails still unread in Gmail?
- **The board:** drag a card with your touchpad in Firefox.
- **Follow-ups:** set one for tomorrow late in the evening, and check it says "Today" next morning. The date field opens Firefox's date picker, in day-month-year order.
- **Strata opening by itself** (if you set up step 8): stop Strata (`stop-strata.bat`). In the app, save an ad. `start-strata-iq2xs.bat` runs, and the ad is read once Strata is ready (the first load takes 1 to 3 minutes). The app keeps using Strata and never stops it.
- **The AI's resume:** read the resume that step 6 wrote (in the test copy, `%USERPROFILE%\JobRegistryTest`, on the job "Senior Data Analyst"). Is everything in it from the sample profile?
