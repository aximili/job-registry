# Windows handover

Job Registry was built and tested on a Mac. These files check it on your Windows PC, with the agent tool doing the work on your local AI — Strata on port 8080 now, or Bonsai 2.

Run 1 (29 Oct 2026) and run 2 (2 Nov 2026) are done: run 2 was a clean run, all steps PASS, no bugs. What is left is the person-checks in do-by-hand.md that only you can do.

| File | For | What it is |
|------|-----|------------|
| [do-by-hand.md](do-by-hand.md) | You | What only you can do: install the programs, start Strata and your agent tool, paste your profile and passwords. Then one sentence starts the agent tool on the runbook. |
| [runbook.md](runbook.md) | The agent tool | 13 numbered steps. Each has the exact command, what to expect, and what to do if it differs. It also lists the only fixes it may make, and what it must never touch. |
| [bug-report.md](bug-report.md) | The agent tool | The fixed format for the bug files in `handover-results\bugs\`, which you bring back to Claude. |
| [findings.md](findings.md) | You and Claude | Bonsai 2's notes on the first run (29 Oct 2026), and what changed after it. |

The checks are scripts in `scripts/handover/`. Each prints PASS, FAIL, SKIP or INFO lines, and keeps them in `handover-results\results.txt`.
- The AI checks use the AI in use (Settings → AI). If that's a cloud AI, they print SKIP: a test copy never gets an API key, and these checks are for Bonsai 2.
- The ones that start and stop the app use a test copy in `%USERPROFILE%\JobRegistryTest`, so your own jobs, settings, profile and secrets are never touched.
- Their logic, and the app and AI checks themselves, are tested on the Mac (`tests/handover.test.ts`, against a fake llama-server). The Windows-only parts (the `.bat` files, killing processes, CUDA, Firefox on Windows) run for the first time on your PC.

The `docs/checklists/phase-*-windows.md` files were the input. The runbook's last table shows where each of their checks is covered.
