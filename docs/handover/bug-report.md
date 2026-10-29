# The bug list format

Write each bug in a file of its own, in `handover-results\bugs\`: `bug-01.md`, `bug-02.md` and so on. Before you write one, run `Get-ChildItem handover-results\bugs` to see the next free number. Use exactly this format, and copy messages exactly: don't shorten or reword them.

```
## Bug 1: <one line: what failed, in your own words>

- Step: <the runbook step, for example "Step 5: Start, check and stop the app">
- Command: `<the exact command you ran>`
- Expected: <the Expect line from the runbook>
- Actual: <every FAIL line, and any error lines, copied exactly>
- Logs: <the log files to attach, for example handover-results\npm-test-e2e.log and handover-results\logs-2026-11-02-10-15-00\>
- Tried: <the fix you tried (F1 to F4) and what happened, or "nothing">
- Type: <bug, flaky or needs you>
```

**Type:**
- **bug:** the app or a script did something wrong.
- **flaky:** it failed once, then passed when you ran the step again.
- **needs you:** something only the user can do (install a program, sign in, paste a password, download the AI).

## An example

```
## Bug 1: The app didn't stop when stop.bat ran

- Step: Step 5: Start, check and stop the app
- Command: `node scripts\handover\app-smoke.ts`
- Expected: app-smoke: all PASS.
- Actual: FAIL the app stops - it still answers after 15 seconds
- Logs: handover-results\logs-2026-11-02-10-15-00\test-copy\
- Tried: F2 (ran cleanup.ts, waited 10 seconds, ran the step again): the same FAIL
- Type: bug
```
