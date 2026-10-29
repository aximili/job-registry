# Windows handover

Job Registry was built and tested on a Mac. These files check it on your Windows PC, with Bonsai 2 doing the work.

| File | For | What it is |
|------|-----|------------|
| [do-by-hand.md](do-by-hand.md) | You | What only you can do: install the programs, start Bonsai 2 and Cline, paste your profile and passwords. Then one sentence starts Bonsai 2 on the runbook. |
| [runbook.md](runbook.md) | Bonsai 2 | 13 numbered steps. Each has the exact command, what to expect, and what to do if it differs. It also lists the only fixes Bonsai 2 may make, and what it must never touch. |
| [bug-report.md](bug-report.md) | Bonsai 2 | The fixed format for the bug files in `handover-results\bugs\`, which you bring back to Claude. |

The checks are scripts in `scripts/handover/`. Each prints PASS, FAIL or INFO lines, and keeps them in `handover-results\results.txt`.
- The ones that start and stop the app use a test copy in `%USERPROFILE%\JobRegistryTest`, so your own jobs, settings, profile and secrets are never touched.
- Their logic, and the app and AI checks themselves, are tested on the Mac (`tests/handover.test.ts`, against a fake llama-server). The Windows-only parts (the `.bat` files, killing processes, CUDA, Firefox on Windows) run for the first time on your PC.

The `docs/checklists/phase-*-windows.md` files were the input. The runbook's last table shows where each of their checks is covered.
