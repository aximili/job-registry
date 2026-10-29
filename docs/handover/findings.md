# Job Registry handover check — findings (2026-10-29)

Runbook: `docs/handover/runbook.md`. This file summarises what was run, what
was found, and what the user told me. Bug files: `handover-results/bugs/bug-01.md`
and `bug-02.md`.

## What was done

Followed the runbook in order:

- **Step 1 — Find the app folder:** PASS. `package.json` present at `F:\CODE\VIBE\job-registry`.
- **Step 2 — Make the results folders:** PASS. Created `handover-results\` and `bugs\`.
- **Step 3 — Prereqs** (`node scripts\handover\prereqs.ts`): ran; **2 FAILs**.
  - PASS: Node.js (v26.12.1), npm (11.20.0), Git (2.51.0), git checkout,
    ~5 TB free disk, NVIDIA GPU (RTX 3090, 24 GB, driver 595.79),
    "Bonsai 2 answers on port 8080", ports 4787/8081/4798/4799 free,
    `config\settings.json` valid, real app running on 4777.
  - FAIL: "Firefox is installed" and "Bonsai 2 and llama-server are downloaded".

The **Step-3 FAIL "Bonsai 2 and llama-server are downloaded" is a STOP trigger**,
so the STOP procedure was followed: both FAILs written as bugs, then **steps
11–13** ran — cleanup all PASS, collect-logs all PASS
(`handover-results\logs-2026-10-29-15-47-11\`), summary written
(`handover-results\summary.md`). Progress is tracked in
`handover-results\progress.txt`.

**Steps 4–10 were not run.**

## Finding 1 — Firefox (bug-01): FALSE NEGATIVE, not a real issue

- Check said: `FAIL Firefox is installed - not found in Program Files. Install it with: winget install Mozilla.Firefox`
- Reality: Firefox **is** installed, as a Microsoft Store app:
  `C:\Users\hardi\AppData\Local\Microsoft\WindowsApps\Mozilla.Firefox_n80bbvh6b1yt2\firefox.exe`
  (plus the launcher stub at `C:\Users\hardi\AppData\Local\Microsoft\WindowsApps\firefox.exe`).
- Why the check missed it: `scripts\handover\prereqs.ts` only searches
  `C:\Program Files\Mozilla Firefox\` and
  `C:\Program Files (x86)\Mozilla Firefox\`. It does not look in
  `%LOCALAPPDATA%\Microsoft\WindowsApps\` (Store installs).
- Action: **none**. Firefox is fine; the browser tests will find it. `bug-01.md`
  was updated (relabelled as a check limitation, not a "needs you" item).

## Finding 2 — Bonsai 2 / llama-server (bug-02): the check's premise vs the user's setup

- Check said: `FAIL Bonsai 2 and llama-server are downloaded - missing F:\CODE\VIBE\job-registry\ai\llama.cpp\llama-server.exe. Run download-ai.bat.`
- What this check actually verifies: the app's **own** llama.cpp server + model
  files under `F:\CODE\VIBE\job-registry\ai\`
  (`ai\llama.cpp\llama-server.exe` + `ai\models\Ternary-Bonsai-2-27B-PQ2_0.gguf`).
  These are only needed if the app is to **START ITS OWN** llama.cpp server
  (e.g. the step-6 test copy, which runs one on port 8081).
- User's clarification: **the app supports any model** (Bonsai 2 via llama.cpp,
  Ollama, LM Studio, or a custom URL — see `docs\architecture.md`). The user
  wants to use Bonsai 2 (the agent) for now and be able to switch later.
- The user's Bonsai 2 is a **separate install** run from
  `D:\aitest\Bonsai-demo\start_bonsai.bat` (a llama.cpp server on port 8080) —
  that's what is running the agent. It satisfies the "Bonsai 2 answers on port
  8080" line (PASSED) but **not** the `ai\` download check. It already contains
  the same model file name (`Ternary-Bonsai-2-27B-PQ2_0.gguf`).

### Consequence (two possible paths)

- **If the app just needs to USE Bonsai 2:** no `ai\` download is required.
  Point the app's AI settings at the external server (custom URL) and it works
  with `ai\` empty.
- **If the runbook check (step 6, ai-smoke) must pass:** it starts its own
  llama.cpp, so it does need `ai\llama.cpp\llama-server.exe` + the model —
  i.e. run `download-ai.bat` in the app folder.

## What's left / next

- Steps 4–10 have not been run.
- Open decision for the user: does the app **use an external Bonsai** (then
  `ai\` can stay empty and step 6's check is moot), or should it **start its own
  llama.cpp** (then run `download-ai.bat` first)?
- After that decision: run steps 4–10, then re-run 11–13 as needed.

## Useful facts

- App folder: `F:\CODE\VIBE\job-registry`
- Agent's Bonsai 2: `D:\aitest\Bonsai-demo`, port 8080 (passing `/health`)
- Real app: running on port 4777
- Master profile (when the user pastes it): `profile\master-profile.md`
  (Settings → Profile → Master profile, or the file directly)
- Test copy location (used by steps 5–6, never touches the real install):
  `%USERPROFILE%\JobRegistryTest`
