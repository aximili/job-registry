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
3. **Run `setup.bat`** (double-click it). Answer **Y** to the Desktop shortcut, your choice to "start when you log in", and **Y** to "Download the AI". The AI is about 8 GB.
4. **Start Bonsai 2:** run `stop.bat` first (if Job Registry is running, it may have started its own AI on port 8080). Then double-click `start-bonsai-server.bat`. Wait until its window says the server is listening. Leave that window open the whole time. Bonsai 2 now runs once, on port 8080, for both the agent tool and the app.
5. **Set up the agent tool: Cline, in VS Code.**
   1. In VS Code, open Extensions (Ctrl+Shift+X), search for **Cline**, and install it.
   2. Open Cline's settings. Set:
      - **API Provider:** OpenAI Compatible
      - **Base URL:** `http://127.0.0.1:8080/v1`
      - **API Key:** `local` (any text works; llama-server doesn't check it)
      - **Model ID:** `bonsai-2` (any name works; llama-server uses the model it loaded)
      - **Context window:** `32768`
      - **Supports images:** off
   3. In Cline's settings, turn on **Use Compact Prompt** (under Features), which helps local models with a small context.
   4. Make sure Cline's terminal is **PowerShell** (VS Code: Terminal → Select Default Profile → PowerShell).
   5. In Cline's auto-approve settings, allow **read files** and **execute commands**. Leave **edit files** off. Bonsai 2 should only ever edit files in `handover-results\`, so approve only those edits. Stay near the PC: each bug it writes waits for your OK.
   6. If you prefer a terminal, OpenCode works too. Point a custom OpenAI-compatible provider at the same base URL.
6. **Open the app folder** in VS Code (File → Open Folder → `C:\JobRegistry`).

## Your own data (10 minutes)

7. **Start the app** with the Desktop shortcut. In **Settings → Profile**, paste your master profile (your full resume) and press **Save**. Add your preferences if you like.
8. **Gmail (optional):**
   1. Make an app password at myaccount.google.com/apppasswords (it needs 2-Step Verification).
   2. In **Settings → Email**, tick "Check Gmail…", enter your Gmail address, paste the app password, and press **Test connection**.
9. **Firefox signing (optional):** to keep the extension installed after a restart, get API keys at addons.mozilla.org (Developer Hub → Manage API Keys). Then set them for your user, in a terminal:
   ```
   setx WEB_EXT_API_KEY "user:12345:678"
   setx WEB_EXT_API_SECRET "your secret"
   ```
   Restart VS Code after that, so Cline sees them.

## Start Bonsai 2 on the runbook

10. In Cline, type: **"Follow docs/handover/runbook.md from Step 1. Read one step at a time, and do every step in order."** It takes about an hour and a half. Approve its edits to files in `handover-results\` when it asks.
11. When it says "Done", bring the `handover-results` folder back to Claude: `summary.md`, `results.txt`, the `bugs` folder and the `logs-…` folder.
12. If Cline loses its place, tell it: "Run Get-Content handover-results\progress.txt and carry on from the next step of docs/handover/runbook.md." 

## How the app and the agent share Bonsai 2

- `start-bonsai-server.bat` runs llama-server with `-np 2`: two requests at once, each with up to 32,768 tokens. So Cline and the app never wait for each other for long.
- The app's default AI setting (Bonsai 2, started by the app) sees a server already answering on port 8080. It uses that server and never stops it, even after 15 idle minutes. So the agent is never cut off.
- During step 6 of the runbook, the test copy starts a second, small llama-server on port 8081 and stops it again. Close games and other GPU-heavy apps while the runbook runs.
- When you've finished, close the Bonsai 2 window. From then on, the app starts and stops Bonsai 2 itself, as usual.

## Your 15-minute check (optional, after the runbook)

These need a person, a signed-in browser or Word. Skip any you don't care about.

- **The extension:** install the signed `.xpi` from `extension\dist\signed\` in Firefox (or load `extension\dist\firefox\manifest.json` in `about:debugging`). Open one job on Seek, LinkedIn and Indeed while signed in. The panel shows the job and **Save** works.
- **Print to PDF:** on a job, make a resume, press **Print / PDF**, then Ctrl+P → Save to PDF. It looks like the preview.
- **.docx:** press **Export .docx** and open it in Word for the web. It looks tidy.
- **Gmail:** after the app has run for 15 minutes with email on, open the Inbox. Do the cards make sense? Were the emails still unread in Gmail?
- **The board:** drag a card with your touchpad in Firefox.
- **Follow-ups:** set one for tomorrow late in the evening, and check it says "Today" next morning. The date field opens Firefox's date picker, in day-month-year order.
- **Bonsai's resume:** read the resume that step 6 wrote (in the test copy, `%USERPROFILE%\JobRegistryTest`, on the job "Senior Data Analyst"). Is everything in it from the sample profile?
