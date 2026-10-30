# What only you can do

Bonsai 2 runs the checks for you (the [runbook](runbook.md)). These steps need you, because they install programs, need your passwords or a signed-in browser, or need a person to look. Allow about an hour, mostly waiting for downloads.

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
   - **N** if you run Bonsai 2 yourself, as you do from `D:\aitest\Bonsai-demo`. The app then uses yours (step 8).
   - **Y** only if you want the app to start and stop its own copy of Bonsai 2. That's about 8 GB.
4. **Start Bonsai 2:** run `stop.bat` first (if Job Registry is running, it may have started its own AI on port 8080). Then start your Bonsai 2: `D:\aitest\Bonsai-demo\start_bonsai.bat`. (If you downloaded the AI in step 3 instead, double-click `start-bonsai-server.bat`.) Wait until its window says the server is listening on port 8080. Leave that window open the whole time. Bonsai 2 now runs once, on port 8080, for both the agent tool and the app.
5. **The agent tool.** It's the tool that runs Bonsai 2 and follows the runbook. Any tool works (yours is KiloCode in VS Code right now; OpenCode, ZCode and others are fine too), if you can set it up like this:
   - **API provider:** OpenAI Compatible, with base URL `http://127.0.0.1:8080/v1`. Any API key and model name work, because llama-server checks neither.
   - **Context window:** the same as your Bonsai 2 gives each request (32,768 with `start-bonsai-server.bat`). No images.
   - **Terminal:** PowerShell, in the app folder (in VS Code: Terminal → Select Default Profile → PowerShell).
   - **Long commands:** it must let one command run for up to 40 minutes (step 8 takes that long). Some tools stop a command after a few minutes: look for a command timeout setting, and raise it.
   - **Approvals:** allow reading files and running commands, but not editing files. Bonsai 2 should only ever edit files in `handover-results\`, so approve only those edits. Stay near the PC: each bug it writes waits for your OK.
6. **Open the app folder** in your agent tool (in VS Code: File → Open Folder → yours is `F:\CODE\VIBE\job-registry`).

## Your own data (10 minutes)

7. **Start the app** with the Desktop shortcut. In **Settings → Profile**, paste your master profile (your full resume) and press **Save**. Add your preferences if you like.
8. **Point the app at your Bonsai 2** (skip this if you answered Y to the download in step 3). In **Settings → AI**, set:
   - **AI server:** Bonsai 2 (llama-server)
   - **Server address:** `http://127.0.0.1:8080/v1`
   - Tick **Start it for me when it isn't running**.
   - **Program or .bat file:** `D:\aitest\Bonsai-demo\start_bonsai.bat`

   Press **Save AI settings**, then **Test connection**. It should say "Connected to Bonsai 2 (llama-server)". The app now sends its AI work to your Bonsai 2, and never stops it.
   - If Bonsai 2 isn't running, the app opens `start_bonsai.bat` in its own window (minimised) the next time it needs the AI for you: when you save an ad, press Test connection, or open a job page or a search list (any rating). Checking Gmail never opens it.
   - Close that window yourself when you want Bonsai 2 to stop. It stays open after Job Registry stops.
   - Already set to "Another OpenAI-style server" from run 1? That still works, but it never starts Bonsai 2 for you.
   - To switch later (to Ollama, LM Studio or the app's own Bonsai 2), pick another AI server here.
9. **Gmail (optional):**
   1. Make an app password at myaccount.google.com/apppasswords (it needs 2-Step Verification).
   2. In **Settings → Email**, tick "Check Gmail…", enter your Gmail address, paste the app password, and press **Test connection**.
10. **Firefox signing (optional):** to keep the extension installed after a restart, get API keys at addons.mozilla.org (Developer Hub → Manage API Keys). Then set them for your user, in a terminal:
   ```
   setx WEB_EXT_API_KEY "user:12345:678"
   setx WEB_EXT_API_SECRET "your secret"
   ```
   Restart your agent tool after that, so it sees them.

## Start Bonsai 2 on the runbook

11. In your agent tool, type: **"Follow docs/handover/runbook.md from Step 1. Read one step at a time, and do every step in order."** It takes about an hour and a half. Approve its edits to files in `handover-results\` when it asks.
12. When it says "Done", bring the `handover-results` folder back to Claude: `summary.md`, `results.txt`, the `bugs` folder and the `logs-…` folder.
13. If it loses its place, tell it: "Run Get-Content handover-results\progress.txt and carry on from the next step of docs/handover/runbook.md." 

## Running the runbook again

After Claude has fixed the bugs from a run:

1. Rename the old `handover-results` folder, for example to `handover-results-1`. The new run then starts clean, and old bugs don't end up in the new summary. Keep the old folder: Claude may ask for it.
2. Get Claude's fixes: in the app folder, run `git pull`.
3. Do any step above that you haven't done yet.
4. In your agent tool, type the same sentence as in step 11.

## How the app and the agent share Bonsai 2

- **Your own Bonsai 2** (Settings → AI with your `start_bonsai.bat`, or Another OpenAI-style server): the app sends it requests and never stops it, so the agent is never cut off. With `start_bonsai.bat`, the app only opens it when nothing answers on port 8080.
  - While a check script runs, the agent tool waits for it, so the two don't compete.
  - Your server's own settings decide how long a request can be (llama-server's `-c`, shared between its `-np` slots). If writing a resume fails with a message about the context size, give it a bigger `-c`. `start-bonsai-server.bat` uses `-c 65536 -np 2`: two requests at once, each up to 32,768 tokens.
- **The app's own Bonsai 2** (Settings → AI → Bonsai 2, started by the app): if a server already answers on port 8080, the app uses it and never stops it, even after 15 idle minutes.
  - During step 6 of the runbook, the test copy starts a second, small llama-server on port 8081 and stops it again. Close games and other GPU-heavy apps while the runbook runs.
  - When you've finished, close the Bonsai 2 window. From then on, the app starts and stops Bonsai 2 itself, as usual.
- **Quick marks on search lists** use the same Bonsai 2. While the agent tool is working, untick "Rate the jobs in search results" in the extension's options, so a search list open in Firefox doesn't keep Bonsai 2 busy. Tick it again when the agent has finished.

## Your 15-minute check (optional, after the runbook)

These need a person, a signed-in browser or Word. Skip any you don't care about.

- **The extension:** install the signed `.xpi` from `extension\dist\signed\` in Firefox (or load `extension\dist\firefox\manifest.json` in `about:debugging`). Open one job on Seek, LinkedIn and Indeed while signed in. The panel shows the job and **Save** works.
  - Updated an older copy of the extension? Open `about:addons` → Job Registry → **Permissions**. Check that au.seek.com and nz.seek.com are allowed, and turn them on if not. Firefox may not grant new sites on an update.
  - Then open one search list on each site. Within a minute, the cards on screen get a mark after their title, one card after another (such as "Good 68 · quick"). A job you saved says "Saved". Scroll down: new cards get marks too, and no card has two. About how many seconds does each card take?
  - Open a job from a Seek search list (the split view). Wait for its full rating in the panel: its card's mark changes to the full one (no "· quick"). Then press **Save**: the card says "Saved".
  - Drag the panel by its top bar ("Job Registry"), and make it bigger from its top-left corner. Open another job: the panel is where you left it. Double-click the bar: it goes back to the corner.
  - Open three quite different jobs. Their match scores should differ, not all be 72.
- **Print to PDF:** on a job, make a resume, press **Print / PDF**, then Ctrl+P → Save to PDF. It looks like the preview.
- **.docx:** press **Export .docx** and open it in Word for the web. It looks tidy.
- **Gmail:** after the app has run for 15 minutes with email on, open the Inbox. Do the cards make sense? Were the emails still unread in Gmail?
- **The board:** drag a card with your touchpad in Firefox.
- **Follow-ups:** set one for tomorrow late in the evening, and check it says "Today" next morning. The date field opens Firefox's date picker, in day-month-year order.
- **Bonsai 2 opening by itself** (if you set up step 8): close Bonsai 2's window. In the app, save an ad. `start_bonsai.bat` opens, minimised in the taskbar, and the ad is read once Bonsai 2 is ready. Then close Job Registry's server window: Bonsai 2 keeps running.
- **Bonsai's resume:** read the resume that step 6 wrote (in the test copy, `%USERPROFILE%\JobRegistryTest`, on the job "Senior Data Analyst"). Is everything in it from the sample profile?
