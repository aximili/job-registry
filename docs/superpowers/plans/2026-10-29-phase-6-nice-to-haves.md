# Phase 6 — Follow-up Reminders and the Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two nice-to-haves the user picked on 29 Oct 2026.
- **Follow-up reminders:** give a job a "follow up on" date, with an optional short reason. The home page lists the jobs that are due (today or late) and coming up (the next 7 days). **Done** clears one.
- **A board view:** one column per status, with a card per job. Drag a card to another column, or use its **Move to** menu, to change the status.

Not wanted: phone access over Wi-Fi, and the Windows-wide hotkey.

**Architecture:** architecture §4 (`jobs`), §5, §8 (`JOBS`), §9, §10.
- Both features live in the `jobs` module and the dashboard. No new module and no new port.
- A follow-up is two columns on `jobs` (`follow_up_on`, a local date, and `follow_up_note`), set by its own endpoint. It never goes through field-source tracking.
- The board reads `GET /jobs?status=all` and moves a job with the existing `POST /jobs/:id/status`, so its history and "date applied" rules are unchanged.

**Tech stack:** as before. No new packages. Drag and drop uses the browser's own HTML drag events.

**Spec:** docs/plan.md, Phase 6: "follow-up reminders" and "a Kanban board view". The plan says nothing more about either, so this plan fills them in. CLAUDE.md has the user's pick.

**Ledger:** `.superpowers/sdd/2026-10-29-phase-6-nice-to-haves/progress.md`. No git writes: each task ends with its test command and result in the ledger.

## Global Constraints

- Everything in the earlier plans' Global Constraints still holds: plain English and Australian spelling, erasable TypeScript, `check:deps` passing without weakening a rule, tests next to the code, Windows scripts in ASCII with CRLF.
- **Migration** `005_follow_ups.sql`, with a test. Never edit 001–004.
- **Dates:** `follow_up_on` is a local date (`YYYY-MM-DD`). "Today" is the server's local date (`localDate(now())`), never the UTC date.
- **Never overwrite your data:** a follow-up changes only when you set it, change it or press **Done**. A status change doesn't clear it, and nor does archiving (archived jobs are just left out of the lists).
- **Moving a card** is a normal status change (`source: manual`), so it is logged in the history and sets "date applied" as usual.
- Copy (exact):
  - section: "Follow up"; groups "Due" and "Coming up"; nothing due: "Nothing to follow up."
  - late: "2 days late", "1 day late"; today: "Today"
  - dialog title: "Follow up"; quick picks "Tomorrow", "In 3 days", "In a week", "In 2 weeks"; field "Reason (optional)"; buttons **Save**, **Clear**, **Cancel**
  - call sheet: "Follow up: 5 Nov 2026 · Chase Sam" with **Change** and **Done**; with none set, a **Follow up** button (`F`)
  - board: heading "Board"; checkbox "Show closed statuses"; a card's menu "Move to"; an empty column "No jobs"

## Review Focus

1. **The date is a day off near midnight.** A follow-up set for tomorrow at 11:30 pm in Sydney is due tomorrow, not today, and "today" never comes from the UTC date. → Task 1 test "today is the local date, not the UTC one".
2. **A follow-up disappears by itself.** Changing the status, archiving and unarchiving, editing the job, or the AI reading the ad leave the follow-up as it was. → Task 1 test "a follow-up survives status changes, edits and the AI".
3. **A failed move leaves the board lying.** When a move fails (the server refuses, or it's not running), the card goes back to its column and the reason is shown. → Task 4 e2e "a refused move puts the card back".
4. **Keyboard and screen-reader users can't use the board.** Every move can be done with the **Move to** menu, the move is announced, and the focus stays on the card that moved. → Task 4 e2e "moves a job with the keyboard".
5. **A status not on the board.** A job whose status was renamed or removed from Settings still shows, in an "Other" column, so it never disappears. → Task 3 test "a job with a status your settings no longer have goes in Other".

---

### Task 1: Follow-ups in the jobs module

**Files:**
- Create: `server/core/db/migrations/005_follow_ups.sql`
- Modify: `shared/contracts/jobs.ts`, `server/modules/jobs/{repo,service,routes}.ts`, `shared/api-client.ts`
- Test: `server/core/db/db.test.ts`, `server/modules/jobs/service.test.ts`, `server/modules/jobs/routes.test.ts`, `shared/api-client.test.ts`

**Interfaces:**
- Produces in the migration: `ALTER TABLE jobs ADD COLUMN follow_up_on TEXT; ALTER TABLE jobs ADD COLUMN follow_up_note TEXT; CREATE INDEX jobs_follow_up ON jobs (follow_up_on) WHERE follow_up_on IS NOT NULL;`
- Produces in contracts: `Job` and `JobSummary` gain `followUpOn: LocalDate.nullable().default(null)` and `followUpNote: z.string().nullable().default(null)`.
  - `SetFollowUpRequest = z.strictObject({ on: LocalDate.nullable(), note: z.string().trim().max(200).nullable().optional() })` (a blank note becomes null; `on: null` clears both)
  - `FollowUpsResponse = z.object({ today: LocalDate, due: z.array(JobSummary), soon: z.array(JobSummary) })`
- Produces in `JobsService`: `setFollowUp(id: number, req: SetFollowUpRequest): Job` (emits `job.updated` with `fields: ['followUpOn', 'followUpNote']`), and `listFollowUps(): FollowUpsResponse` (not archived; `due` = on ≤ today, oldest first; `soon` = today < on ≤ today + 7, soonest first).
- Produces routes: `PUT /jobs/:id/follow-up` → `Job`; `GET /jobs/follow-ups` → `FollowUpsResponse`. Writes from an extension are allowed, as for other job writes.
- Produces `api.setFollowUp(id, req)`, `api.followUps()`.

- [ ] **Step 1: Write the failing tests:**
  - migration "upgrades a version 4 database to version 5, keeps the data, and adds the follow-up columns".
  - service:
    - "sets, changes and clears a follow-up"
    - "a blank reason is no reason"
    - "lists what's due and coming up, and leaves out archived jobs and later ones"
    - "today is the local date, not the UTC one": the clock is 2026-10-29T13:30:00Z, which is 30 Oct 00:30 in Sydney, and the tests run in Sydney time. A follow-up on 30 Oct is due.
    - "a follow-up survives status changes, edits and the AI" (`changeStatus`, `update`, `applyParsed`, archive and unarchive)
    - "an unknown job is not found"
  - routes: PUT with a bad date gives 400; GET gives `{ today, due, soon }`.
  - api-client: `setFollowUp` sends PUT with `{ on, note }`.
- [ ] **Step 2: Run** `npx vitest run server/core/db server/modules/jobs shared/api-client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `followUpOn` and `followUpNote` join `JobChanges` and the plain columns, but not `EditableJobFields`, so `PATCH /jobs/:id` can't set them.
  - "Today + 7" is worked out on the local date, by calendar days.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

### Task 2: Dashboard: follow-ups on the job page and the home page

**Files:**
- Create: `web/src/components/FollowUpDialog.svelte`, `web/src/components/FollowUps.svelte`, `web/src/lib/follow-up.ts`
- Modify: `web/src/components/CallSheet.svelte`, `web/src/pages/JobPage.svelte` (the `F` key), `web/src/pages/HomePage.svelte`
- Test: `web/src/lib/follow-up.test.ts`, `tests/e2e/follow-up.spec.ts`, `tests/e2e/serve.ts` (unchanged reset: the columns are on `jobs`)

**Interfaces:**
- Produces in `web/src/lib/follow-up.ts`:
  - `addDays(local: string, days: number): string` (calendar days on a local date)
  - `lateness(on: string, today: string): string` ("Today", "1 day late", "3 days late", or "" when it's later)
  - `QUICK_PICKS: { label: string; days: number }[]` (Tomorrow 1, In 3 days 3, In a week 7, In 2 weeks 14)

**What it shows:**
- The call sheet's facts list gets "Follow up: 5 Nov 2026 · Chase Sam" (late in the danger colour). There's **Change** and **Done**, or a **Follow up** button (`F`) when nothing is set.
- The dialog has the quick picks (which set the date field), a date field, "Reason (optional)", and **Save**, **Clear** (only when one is set) and **Cancel**. Saving announces "Follow-up saved for 5 Nov 2026."
- The home page shows a "Follow up" section above the list, only when something is due or coming up. It has "Due" (each with its lateness) and "Coming up" (each with its date). Each row is a job link with the reason and a **Done** button. **Done** announces "Done: Senior Engineer at Atlassian." and moves the focus to the next row's **Done**, or to the section heading.
- Live updates: the section reloads on `job.updated`.

- [ ] **Step 1: Write the failing tests:**
  - unit: `addDays` across a month end and a year end; `lateness` for today, 1 day, 3 days and the future.
  - e2e (both browsers):
    - "set a follow-up with a quick pick, and it shows on the call sheet and the home page"
    - "Done clears it from the home page and the call sheet, and the focus moves on"
    - "F opens the dialog, and Escape closes it"
    - "Clear takes the follow-up away"
    - "a late follow-up says how late"
  - Seed a past date through `PUT /api/v1/jobs/:id/follow-up`.
- [ ] **Step 2: Run** the unit test and `npm run test:e2e -- tests/e2e/follow-up.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, following `EditJobDialog.svelte` for the dialog.
- [ ] **Step 4: Run** the spec. Expected: PASS in both browsers. `npm test`. Expected: PASS.

**Checkpoint review after Task 2** (fresh Opus reviewer: Tasks 1–2).

### Task 3: The board's grouping

**Files:**
- Create: `web/src/lib/board.ts`
- Test: `web/src/lib/board.test.ts`

**Interfaces:**
- Produces `boardColumns(jobs: JobSummary[], statuses: Status[], o: { showClosed: boolean }): { id: string; label: string; closed: boolean; jobs: JobSummary[] }[]`:
  - columns follow the statuses' `order`, with closed ones only when `showClosed` is on
  - each column's jobs are most recently updated first
  - a job whose status isn't in `statuses` goes in a last column `{ id: '__other', label: 'Other', closed: false }`, which shows only when it has jobs
  - jobs in closed statuses are left out when `showClosed` is off.

- [ ] **Step 1: Write the failing tests:**
  - "one column per open status, in order"
  - "closed columns only when asked"
  - "newest first in each column"
  - "a job with a status your settings no longer have goes in Other"
  - "no Other column when every status is known"
- [ ] **Step 2: Run** `npx vitest run web/src/lib/board.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it. Expected: PASS.

### Task 4: The board page

**Files:**
- Create: `web/src/pages/BoardPage.svelte`, `web/src/components/BoardCard.svelte`
- Modify: `web/src/lib/router.svelte.ts` (`{ name: 'board' }` at `/board`), `web/src/App.svelte`, `web/src/components/Header.svelte` (a **Board** link)
- Test: `tests/e2e/board.spec.ts`

**What it shows:**
- The page:
  - the heading "Board", and the checkbox "Show closed statuses", remembered in `localStorage` (`jr-board-closed`)
  - one column per status: its label and the number of jobs in it, then its cards. An empty column says "No jobs".
- A card shows:
  - the title as a link to the job, and the company (or agency)
  - "Applied 12 Oct" when set
  - a follow-up badge ("Follow up 5 Nov", or "Follow up: 2 days late" in the danger colour)
  - a "Move to" select that lists every status except the current one.
- **Moving a card:**
  - Drag it to another column. The column shows where it will land while you drag over it.
  - Or choose a status in its "Move to" menu.
  - Either way the card moves straight away, then `POST /jobs/:id/status` is sent.
  - When it's done, the app announces "Moved Senior Engineer to Interview 1." and the focus goes to that card's "Move to" in its new column.
  - When it fails, the card goes back to its column, and the error shows (`role="alert"`).
- Live updates: the board reloads on the job events (debounced, as on the home page), but never while a move is being sent.

- [ ] **Step 1: Write the failing e2e tests** (both browsers):
  - "shows a column per open status with its jobs"
  - "drags a job to another column, and its status changes" (with Playwright's `dragTo`)
  - "moves a job with the keyboard": the "Move to" select, the announcement, and the focus on the moved card's select
  - "Show closed statuses adds the closed columns, and is remembered"
  - "a refused move puts the card back": route `POST **/status` to answer 400 with an error body through `page.route`
  - "a follow-up shows on the card"
- [ ] **Step 2: Run** `npm run test:e2e -- tests/e2e/board.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:e2e` (the whole suite). Expected: PASS. `npm test`. Expected: PASS.

### Task 5: Docs and the done check

**Files:**
- Modify: `docs/architecture.md` (§4.1, §5, §8, §9, §10 pages and keys), `README.md` (follow-ups, the board, the `F` key), `CLAUDE.md` (status), `docs/plan.md` (status)
- Create: `docs/checklists/phase-6-windows.md` (handover input)

- [ ] **Step 1:** Write the docs. The Windows-only items:
  - drag and drop in real Firefox on Windows, with a mouse and with a touchpad
  - the date field in Firefox on Windows (the date picker, and Australian date order)
  - a follow-up set late at night shows as due on the right day.
- [ ] **Step 2: The done check:** `npm test`, `npm run test:e2e`, `npm run ext:lint`. Record the counts.
- [ ] **Step 3:** Final review (fresh Opus reviewer, whole phase). Fix every critical and important finding with a test that fails first.
