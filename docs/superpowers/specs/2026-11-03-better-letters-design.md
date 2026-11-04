# Better letters, and getting ready for a job — design

**Date:** 3 Nov 2026. **Phase:** 9 (asked for on 3 Nov 2026).
**Status:** written while the user is away. The user's brief (`temp/phase-9-inputs/prompt.md`) holds their decisions, and they asked for the whole phase to be built without stopping. Every other decision here is marked **(my call)**, and the ledger repeats each one with a "Cost if wrong" line.

## Why

On 3 Nov 2026 the user compared two cover letters for the same ad: one this app wrote on Bonsai 2, and one Claude Opus wrote in a chat. The Opus letter is much stronger. There are three causes:

1. **Missing facts.** Opus asked the user questions first. The app can't, and its guide says "You can't ask me questions here."
2. **A dropped fact.** Seek shows the contact as "••••@example.com.au". Only the `mailto:` link holds the name, and the extension keeps only the text on screen.
3. **Weak choices.** Bonsai matched the ad's skills list and used vague names. Opus answered what the ad values, with one short story each, and opened with the ad's most telling line.

The fixes: write with a stronger AI when you have one (A), keep the dropped fact and give the writer your notes (B), and add a short brief that you check before the AI writes (C). Then a prep plan helps you get ready for the interview (D).

The inputs in `temp/phase-9-inputs/` hold real personal details. Nothing from them goes into a tracked file: every fixture, test, guide example and prompt uses made-up names and facts.

## Goals

1. Pick one saved AI to do the writing: resumes, cover letters, the brief and the prep plan. Everything else stays on the AI in use.
2. Keep a contact's email address that only a `mailto:` link shows.
3. Give every writing task the job's notes.
4. A better cover-letter guide that reaches the user's Windows copy.
5. A brief the user checks and fixes in a few clicks before the AI writes, saved with the job.
6. A prep plan for each job, saved with the job.
7. Every request to Bonsai 2 fits its 32,768-token window with the user's real profile, with room left to think.

## Non-goals

- A writer per document kind (one writing AI covers all four writing tasks).
- A switcher in the extension, or the extension showing briefs or plans.
- Editing a prep plan, or ticking off its steps.
- Asking the AI for links, courses or employer research.
- Updating the CSS templates the way the guides are updated (they haven't changed).
- Timing or tuning on the real Bonsai 2 27B (that's the user's, on Windows).

## Anti-goals (a failure even if it works)

- **A real fact gets into the repo.** Any of the user's real details in a tracked file, from the inputs or the real profile.
- **The app overwrites the user's text.** A guide the user changed is replaced without their click, or any old text is lost (a guide, the master profile).
- **The profile changes beyond the one heading.** "Add to my profile" edits anything other than its own dated lines under its own heading.
- **A request overflows Bonsai 2.** With the user's 86k-character profile, a writing request leaves no room to think and fails with "out of room".
- **A writing AI's problem lands on the pill,** or a cloud writing AI's draft holds up ratings on Bonsai 2.
- **The AI invents.** A link, an employer fact the ad doesn't give, or a claim the profile says not to make, in a brief or a plan.
- **A paid AI runs without the user's choice.** Nothing picks a cloud writing AI by itself, and no installed extension can start a brief, a plan or a draft.

## Constraints

- AGENTS.md, architecture.md §4 and §15 hold. `npm run check:deps` passes and no rule is weakened. New allowed dependencies go into `.dependency-cruiser.cjs` and §4.2 together.
- Erasable TypeScript only. Plain SQL, one new numbered migration, old ones untouched.
- Prompts are text files in `server/modules/ai/prompts/`. Plain English and Australian spelling in prompts, the UI, docs and comments.
- No test calls a real cloud AI. No real model is downloaded or run. The fakes in `tests/fakes/` cover everything.
- `data/`, `config/` and `profile/` are never touched. Tests use temporary copies, as `shoot.ts` does.
- The real master profile in `~/Downloads` (named in the user's brief; 85,765 characters, 13,173 words, about 21k tokens) is read only to measure. It's never copied into the repo, a fixture or a test.
- Any Windows script touched stays plain ASCII with CRLF.
- Every new or changed screen goes through the design-first skill. The user is away, so the builder builds two or three real options, shoots them in both themes and at both widths, picks the best by the skill's checks and AGENTS.md's UX rules, records why in the ledger with the screenshot paths, and removes the rest.

## The design

### A. Write with another AI

**The setting** (`shared/contracts/ai.ts`)
- The `ai` section gains `writer: AiId | null`, default `null`, meaning "the AI in use". So an old file keeps today's behaviour.
- `writer` isn't refined to name a saved AI, so a hand edit that removes the AI still loads. `writingAi(ai)` gives `{ ai: SavedAi, inUse: boolean, missing: boolean }`: the writer if it's saved, else the AI in use (`missing` is true when `writer` names an AI that isn't saved).
- `settings.update()`: a save whose `writer` isn't among the saved AIs after the save sets it to `null` (like a deleted AI's key). The dashboard also sends `null` for a writer it can't find. So a later AI that gets the same id never becomes the writer by accident. **(my call)**
- `PUT /settings/ai/writer` `{ id: AiId | null }` (dashboard-only) sets it at once and emits `settings.changed` with `keys: ['ai']`. An unknown id is refused.
- Two new task blocks on every saved AI: `tasks.brief` and `tasks.prep`. Defaults **(my call)**: brief, temperature 0.3, longest answer 3,072, thinking Medium (2,048); prep, temperature 0.4, longest answer 4,096, thinking Low (512). Both fit the window (see "The budget").

**Which tasks use it.** `writeDocument` (resume and cover letter), the brief and the prep plan run on the writing AI, with that AI's own task settings and key. Parsing, rating, quick marks and email stay on the AI in use.

**Problems.** When the writing AI is the AI in use, everything is as today: the pill shows its state and problems. When it's another AI:
- Its problems (no key, a refused key, a usage limit, can't reach it) come back to where you write, as the stream's error line or the brief's or plan's error. They never set the pill's problem, its state, or "Right now".
- **A local writing AI that isn't the AI in use is never started or stopped by the app.** It's used if it answers; otherwise its provider's own "Can't reach {name} at {address}…" sentence shows where you write. The model-file check (§12.5) still runs, so another model answering on its address says so. **(my call)**: starting a second local program would fight the first for the GPU.

**The queue** (`server/modules/ai/queue.ts`, the decision record 0012). One GPU means one local task at a time. A cloud AI doesn't use the GPU.
- Every task on the AI in use goes through the main queue, exactly as today.
- A writing task on another **local** AI goes through the main queue too (it shares the GPU), at `interactive` priority.
- A writing task on another **cloud** AI goes into that AI's own lane: a queue of its own, one task at a time. So it never waits behind local ratings, and a long Claude draft never holds up Bonsai 2's ratings. One at a time per cloud AI keeps the order and "latest wins" simple, and stays clear of the provider's rate limits.
- "Latest wins" holds across lanes: a keyed task cancels the same key in every lane.
- `stop()`, `stopNow()` and `onIdle()` cover every lane.
- **(my call)** When the AI in use is a cloud AI and the writer is a local one, the local write waits in the main queue with the cloud tasks. That's rare, and it keeps the GPU rule whole.

**Providers.** `app.ts` keeps the writing AI's provider as it keeps the AI in use's (only the saved object, while its settings and key stay the same, dropped on any `settings.changed` with `ai`), so Claude's connector keeps its model limits between drafts.

**The UI** (design-first; see "Screens")
- **Settings → AI:** one new setting near My AIs: the writing AI. "The AI in use ({name})" first, then every saved AI by name. It saves at once, like **Use this**. Its help line says what it covers, and that ratings, quick marks, reading ads and emails stay on the AI in use. Two new task rows: "Making the brief" and "Making the prep plan".
- **Where you write and where you get ready:** the writing AI's name shows beside the main button ("Writes with Claude – mine"), with a one-click way to change it (the same list as Settings, saved at once, with a toast "{name} writes your documents now.").
- **Delete:** deleting the writing AI in Settings → AI says so in its question ("{name} also writes your documents. After this, the AI in use writes them.").
- **Fallback:** when `missing` is true, the writer line says "Your writing AI isn't saved any more, so {name}, the AI in use, writes." in both places.

### B. Small fixes

**B1. Contact emails** (`extension/src/text.ts` and `server/core/html-text.ts`, which `readableText` uses for ads and the email reader for HTML mail)
- An `<a href="mailto:…">` link keeps its address when its text doesn't show it in full. The address is the part before any `?`, URI-decoded. Several addresses (comma-separated) count as one string.
- The text shows it (case-insensitive) → the text only. Empty text → the address. Otherwise → `text (address)`. So "••••@example.com.au" becomes "••••@example.com.au (Alex@example.com.au)", and "email Alex" becomes "email Alex (Alex@example.com.au)".
- Only an address with an `@` counts. Both readers follow the same rules and share one table of test cases.
- `parse-job.md`'s `adContact` rule changes: fill it when the ad gives a person or an address to contact. When a link's text hides the address, the address in brackets after it is the real one.
- Tests: made-up fixtures in the extension's Seek tests and the server's HTML tests.

**B2. Job notes in every writing task**
- The resume, the cover letter, the brief and the prep plan all get the job's notes, newest first, each with its date ("3 Nov 2026: …").
- **Every note counts**, the ones the email reader adds on Confirm too ("Email, 3 Nov 2026 (interview) from …"): they're summaries of real emails about the job, and a prep plan needs an interview invite most of all (question 3; **my call**).
- **Cap: 1,200 characters in all (my call).** Whole notes until the cap; the note that crosses it is cut with "…"; any older ones are left out with "(Older notes left out.)". Tested.
- The prompts say: these are my notes on this job; they're true, and follow any wishes in them.
- The editor's fact-check counts the job's notes and the brief's answers as facts from you, beside the master profile, so a letter that uses an answer isn't flagged.

**B3. The cover-letter guide** (`starters/profile/cover-letter-guide.md`)
- It stays at 1,441 words or fewer (a test counts). Lines are changed and replaced, not added.
- The 250–400-word limit stays.
- **Contact:** a first name in the contact's email counts as their name ("Dear Sam,"). For a recruiter's ad ("We're representing…"), write to the recruiter.
- **Opening:** the ad's most telling line, in its own words, then why it fits me. Never restate the skills list.
- **Body:** answer what the ad values, not only its skills. One short story per need: the problem, what I did, the result. Name the client and the product as my profile allows. No strings of tool names.
- **A missing must-have:** near the end, before the close. My nearest real evidence, including any self-study my profile records. No stock plan (this replaces "Never skip the plan").
- **Contractions:** I'm, I've, I'd.
- "You can't ask me questions here" becomes: my answers and the approved brief, when given, are facts from me. **(my call)** The resume guide's same line changes the same way (replaced, not added), so the resume writer takes the answers too.
- **The plan step:** when an approved brief is given, it's the plan; follow it in place of Step 1.
- Every example is made up (a test checks the guide has none of a list of real names from the inputs, kept in the test as hashes, not as text).

**B4. Getting the new guide to the user** (`server/modules/profile/service.ts`)
- **Starter history:** the SHA-256 of every earlier starter version of each guide (from git: commits 67c19c5, 5ac1b81 and 75011e0), in a small table in the profile module. Text is compared after Windows line endings become `\n` and a byte-order mark is dropped, because Git for Windows checks `.md` files out with CRLF. A test checks the table against `git log` and `git show` when git is there.
- **At start-up** (`syncStarters`, which replaces `installStarters`):
  - a missing guide or template is copied in, as today
  - a guide that is exactly an earlier starter is replaced by the new one, and the old text is kept (below)
  - anything else is left alone.
- **Settings → Profile** says when a newer starter guide is ready: when your guide differs from the current starter, and you haven't seen this starter yet. It shows what changes (a line-by-line diff of your guide against the new starter), with **Use the new guide** and **Keep mine**, one click each. Use keeps your old text and puts the starter in. Keep remembers you've seen this starter, so the note goes until a newer one comes.
- **What you've seen** lives in `profile/.starter-versions.json` (`{ name: starter hash }`), written when a starter is copied, used or kept. With no record (every install before Phase 9), the starter you had was an earlier one, so a guide you changed gets the note. **(my call)**
- **Old text is never lost:** before the app replaces a guide or changes the master profile, it copies the file to `profile/old-versions/<name>-<YYYY-MM-DD-HHMMSS>.md` (local time; `-2`, `-3` if taken). Backups already copy `profile/`.
- API: `GET /profile/starters` (each guide's state, and the diff when a newer starter is ready), `POST /profile/:name/starter` `{ action: 'use' | 'keep' }` (dashboard-only). The diff is a pure helper in `shared/`, so its tests are table-driven.

### C. "Before I write": a brief you can check

**The task.** One JSON task, `briefJob`, with its own prompt file (`server/modules/ai/prompts/make-brief.md`) and task settings (`tasks.brief`), on the writing AI. Input: the master profile, the job's details, its newest ad, the job's notes, the answers from the job's previous brief (so a new brief doesn't ask again), and today's date. The AI answers:

- **contact:** `{ name, email, recruiter, organisation }`. A first name in the email counts as the name. `recruiter` is true when the ad is from a recruiter.
- **needs:** the ad's 2 or 3 biggest needs, in its own words, each with the best story from the profile (`{ title, text }`: the problem, what I did, the result), plus up to 2 others to swap in.
- **opening:** `{ quote, why }`: the ad's most telling line, quoted exactly, and why it fits me.
- **gaps:** each must-have I lack, with my nearest real evidence (self-study included).
- **questions:** up to 5, each `{ question, why }`, only where the answer would change the document: a must-have the profile is silent on, a "To confirm" or ⚠ item the ad touches, or whether something can be named. Never what the profile already answers. Each answerable in a sentence.

The schema puts the reasons before the choices where it can (the Phase 7 lesson: a small model picks first and justifies after). The prompt forbids anything under "Don't claim". **(my call)** field order: contact, needs, opening, gaps, questions.

**Cut, never refuse.** The schema asks for at most 3 needs, 2 others each, 5 gaps and 5 questions (JSON Schema `maxItems`, so llama-server's grammar keeps to them). The service also cuts any longer list or text to the caps below, so a long answer never fails a brief. Caps **(my call)**: names and emails 120, a need 160, a story's title 80 and text 320, the quote 300, its why 240, a gap 160 and its evidence 240, a question 160 and its why 160; an answer you type, 240.

**The quote is checked.** The server looks for the quote in the ad (spaces and case ignored). If it isn't there, the brief says "This line isn't word for word in the ad. Check it." beside it.

**Saved with the job.** A new module, `prep`, owns two tables (migration `007_prep.sql`): `briefs` and `prep_plans`. Each brief row holds the brief as you've edited it (JSON, checked by zod on every read and write), the name of the AI that made it, when it was made, last changed and last written with (`approved_at`). A new brief is a new row; the newest is the job's brief, and older ones stay. Briefs are reused by every later document and by the prep plan.

**What you can do, each in a click or two:**
- edit the contact's name, and whether it's a recruiter
- swap a need's story for one of its others (one click)
- drop a need, or bring it back (one click)
- answer a question (type it), or skip it (one click)
- tick "Add to my profile" on an answer.

Every change saves as you make it (`PATCH /briefs/:id`).

**Writing.** One main button writes the document with the brief ("Write the cover letter", "Write the resume"). "Skip, just write" writes without it, and "New brief" makes a fresh one. Each is one click.
- `POST /jobs/:id/documents/generate` gains `brief: 'use' | 'skip'` (default `'skip'`, so the handover's scripts and older calls work as before). With `'use'`, the writer gets the job's newest brief, and it's marked approved.
- The writer gets the approved brief as a short block, in place of its own plan step. The cover letter gets all of it; the resume gets the needs, gaps and answers. Dropped needs and skipped questions are left out.
- **When the job has no brief,** pressing the write button makes one first (with progress and Cancel), then shows it for you to check. **(my call)** It never writes straight on from a new brief: checking it is the point.
- **When it has one,** the brief shows above the editor, ready, and the main button writes with it.

**Progress and cancel.** Making a brief streams NDJSON lines, like a draft: `waiting` (in the queue), `working` (the AI has started), then `done` with the brief or `error` with a sentence. The UI shows which, with the seconds so far, and **Cancel**. Closing the request cancels the AI task. With the user's profile, Bonsai 2 may take as long as a rating.

**"Add to my profile."** When you press the main write button, each ticked answer not yet added becomes one line at the end of the master profile (`POST /briefs/:id/answers-to-profile`, dashboard-only, called by the dashboard just before it writes):
- under one heading, `## Answers from my applications`, which is added at the end of the file the first time
- if that heading is already there, the lines go at the end of its section
- one line per answer: `- 3 Nov 2026, Senior Engineer at Example Co: {question} {answer}` (newlines in an answer become spaces)
- it never changes anything else, and it copies the profile to `profile/old-versions/` first
- each answer is added once (the brief remembers when), and the toast says how many were added.

Changing the master profile changes its hash, so each job is rated once more, as after any profile edit.

### D. "Get ready" for a job

**The task.** One JSON task, `prepJob`, with its own prompt file (`server/modules/ai/prompts/make-prep.md`) and task settings (`tasks.prep`), on the writing AI. Input: the master profile, the job's details, its newest ad, its notes, and the newest brief's needs, gaps and answers, when there's a brief. The plan has five parts:

1. **Learn in a day:** up to 5 topics, from the must-haves I lack or am weak in, most valuable first. Each has why it matters for this job, 2 to 4 concrete steps, the hours, and what I can honestly say afterwards.
2. **A practice project:** one project I can build in a day that touches those gaps and the ad's field, with what I can say afterwards.
3. **Likely interview questions:** up to 6, each with the story from my profile to tell.
4. **Questions to ask them:** up to 5, from what the ad leaves open.
5. **Refresh before the interview:** the items my profile marks to refresh or confirm that this job touches.

The prompt forbids links and URLs, anything about the employer the ad doesn't say, and any claim the profile says not to make. The service also removes anything that looks like a link (`http`, `https`, `www.`) before saving, as a safety net. Lists are cut to their caps, as for the brief.

**Saved with the job** in `prep_plans`: a new plan is a new row, the old ones stay, and the newest shows. `GET /jobs/:id/prep` lists them, newest first. `POST /jobs/:id/prep` makes one, streamed like the brief (`waiting`, `working`, `done`, `error`). Dashboard-only.

**On the job page,** one button, "Get ready", makes a plan; once there is one, it's shown, with "New plan" and the earlier plans by date. The writing AI's name and the one-click change sit beside the button.

### The budget (Bonsai 2's 32,768 tokens)

**The rule.** Every request must fit in about 27,000 tokens in the worst case, so thinking and the answer have about 5,700 left. Measured on the user's real profile: 85,765 characters for about 21,000 tokens, so 4.08 characters a token. The app counts **4 characters a token** (a little cautious), so a request may hold **108,000 characters**.

**Fixed caps** (all tested; **my call**):

| Part | Cap |
|------|-----|
| The job's notes | 1,200 characters in all |
| One answer you type | 240 characters |
| The answers block (up to 5 questions with answers) | 2,000 characters |
| The brief as the writer gets it, answers included | 4,500 characters |
| The job's details (role, company, lists) | 2,000 characters |
| The ad | 12,000 characters, as today |

**Fitting the ad.** On an AI on this computer, the ad gets what's left of the 108,000 characters after everything else, up to its 12,000, and never less than 2,000. A cut ad ends with "[The rest of the ad was cut.]", as today. A cloud AI's window is far bigger, so it gets the plain caps only. **(my call)**

**When it still doesn't fit** (the builder check's question 1; **my call**). The profile grows with each answer you add, and your guide is yours to lengthen, so a request can pass 108,000 even with the ad at its floor.
- Up to **120,000 characters** (about 30,000 tokens), it's sent anyway: a little less room to think, but it usually works.
- Over 120,000, it's refused before anything is sent, where you write, with: "This is too long for {name}: about {n} characters, and it fits about 108,000. Shorten your master profile or your guide, or pick a cloud AI to write (Settings → AI)." It never touches the pill. A cloud AI is never refused.

**The brief block's shares** (question 4; **my call**). The brief's own caps add up to more than 4,000, so each part of the block the writer gets has a share: contact 200, opening line 450, needs 1,600, gaps 750, answers 1,500 (4,500 in all). Every item is kept: a part over its share cuts each item's text evenly, with "…". The resume and the prep plan leave out the contact and the opening line. The saved brief and the screen keep everything.

**The worst case with the user's profile** (built from the real prompt files and starter guides, with every cap full; measured by a script kept in the ledger folder, never in the repo):

| Request | Without the ad | The ad gets |
|---------|----------------|-------------|
| Brief | about 94,000 | 12,000 (all of it) |
| Prep plan | about 96,000 | about 11,500 |
| Cover letter, with a brief | about 104,500 | about 3,500 |
| Resume, with a brief | about 106,000 | 2,000 (the floor) |

The builder confirms these numbers with the real files once the prompts are written, and records them in the ledger. A test builds each request with a made-up profile of 86,000 characters and every cap full, and checks it's 108,000 characters or fewer. If a real number comes out over, the builder trims the prompt's own words first, then lowers a cap, and records it.

**The answer's room.** Brief: 3,072 + 2,048 thinking; prep: 4,096 + 512. Both stay under the window with a 27,000-token request. Writing keeps today's No limit (the user's pick in Phase 7), so on Bonsai 2 a full request leaves about 5,700 tokens to think and write: enough for a letter, tight for a long resume. That's best effort, as it is today with this profile (question 2; **my call**). A cut-off answer gives today's "out of room" sentence. The real fix is a cloud writing AI, or Writing's thinking at Medium in Settings → AI; the Windows checklist times both on Bonsai 2 27B.

### Prompts

- **One shared system part for the four writing tasks** (`make-brief.md`, `make-prep.md`, `write-resume.md`, `write-cover-letter.md`), word for word: who I am to the AI, the rules that hold for every task (facts only from my profile, notes and answers; never invent; Australian spelling), then my master profile. Each task's own rules, the guide, the job, the brief, the notes and the ad go in the user part. So llama-server reuses its cache of the profile (about 21k tokens, most of a minute on Bonsai 2) from the brief to the letter to the plan, and Claude's prompt caching covers it too. A test checks the four match, as one does for the two rating prompts. **(my call)**
- `write-cover-letter.md` and `write-resume.md` gain `{{brief}}` and `{{notes}}`. With no brief: "No brief: plan it yourself, as my guide says." With no notes: "No notes."
- Preferences stay out of the writing tasks: the guides say never to mention salary. **(my call)**

### Events

- `brief.saved` `{ jobId, briefId }` (made or edited) and `prep.saved` `{ jobId, planId }`, sent by `prep`, heard by `live`. The job page and the editor reload when they're about the job on screen.
- `profile.changed` `{ name }` when answers are added to the master profile, or a starter guide is used.

### Modules

- **`prep`** (new, composite): owns `briefs` and `prep_plans`. Depends on `ai`, `profile`, `jobs`, `notes`. Public: `brief(jobId)`, `makeBrief(jobId, { signal, onState })`, `editBrief(id, edits)`, `approvedBrief(jobId)` (marks it approved), `addAnswersToProfile(id)`, `plans(jobId)`, `makePlan(jobId, { signal, onState })`.
- **`documents`** gains `notes` and `prep`: `generate` reads the job's notes and, with `brief: 'use'`, the approved brief.
- **`profile`** gains `syncStarters()`, `starters()`, `useStarter(name)`, `keepStarter(name)` and `appendAnswers(lines)`, and the copy to `old-versions/`.
- **`ai`** gains `briefJob()`, `prepJob()`, the writer's routing and the lanes. It stays free of jobs: text and typed values in, typed results out. The caps and the fit live here (`server/modules/ai/budget.ts`), so they're tested with plain strings.
- **`settings`** gains `useWriter(id)`.

### Screens (design-first, picked by the builder)

Each gets two or three real options, shot in both themes at both widths, picked by the skill's checks and AGENTS.md, with the reason and the screenshot paths in the ledger. `shoot.ts` gains the pages it needs (for example `brief`, `prep`, `starter`, `writer`), with made-up data from the fake AI.

1. **The editor with the brief** ("Before I write"): where the brief sits beside or above the editor, how a need's stories are swapped, how questions are answered and skipped, the progress line, and the writer's name with its one-click change. The main write button is the boldest thing on the page.
2. **The job page's "Get ready"**: where the button and the plan sit, how the five parts read, the earlier plans.
3. **Settings → AI's writing AI**: where it sits and how it reads.
4. **Settings → Profile's starter note**: the note, the diff, and its two buttons.

Every screen works with the keyboard alone (the brief's controls in a sensible tab order, Escape never losing work), passes the measured contrast (4.5:1 for text, 3:1 for the edges of fields and buttons, in both themes), and reads at half width. Progress is announced (`aria-live`), and a finished brief or plan moves the focus to its heading.

### Docs

- `docs/architecture.md`: §4.1 and §4.2 (the `prep` module and the new dependencies), §5 (events), §7 (a key flow for the brief), §8 (the two tables), §9 (endpoints), §10 (the screens' rules), §12 (the tasks, the writing AI, the lanes, the budget), §13 (old versions of profile files), §14, §17 (risks: the window, the cost of a cloud writer).
- `docs/decisions/0012-writing-ai-and-briefs.md`: the writing AI, the lanes, the brief, and the budget.
- `AGENTS.md` "Current status": a Phase 9 entry. `docs/plan.md`: the phase.
- `docs/checklists/phase-9-windows.md` (new).
- `docs/handover/do-by-hand.md`: pick a writing AI once a Claude key is in; time a brief and a plan on Bonsai 2 27B with the real profile; look at the starter-guide note after the update.

## Testing

TDD throughout, a failing test first. Unit and API tests cover:
- `writingAi` and the writer setting: the default, a missing writer, a deleted writer nulled on save, `PUT /settings/ai/writer`, dashboard-only.
- The writer's routing: each writing task runs on the writing AI with its task settings and key; ratings stay on the AI in use; a writing AI's failure never sets the pill; a cloud writer's task runs while a local task holds the main queue; a local writer that doesn't answer fails with its sentence and is never started; latest wins across lanes; stop covers every lane.
- B1's table of link cases, in both readers.
- Every cap and the fit, with a made-up 86,000-character profile; the four writing prompts' shared system part.
- The brief: cutting long lists and text, the quote check, edits, answers to the profile (the heading made once, lines at the end of its section, nothing else changed, the copy in `old-versions/`, each answer once), a new brief that carries old answers, `generate` with `'use'` and `'skip'`.
- The plan: links removed, lists cut, newest first, the old ones kept.
- Starters: an earlier starter replaced at start-up with its copy kept, a changed guide left alone, CRLF treated as LF, the history table against git, use and keep, the diff helper.
- The guide: 1,441 words or fewer, its required lines, no real names.

Browser tests (Firefox and Chromium, fake AI only): make a brief, swap a story, drop a need, answer and skip, write with it, skip and write, a new brief, cancel; "Get ready" and a new plan; change the writing AI from the editor and from Settings → AI; the starter note's use and keep. `npm test`, `npm run test:e2e` and `npm run ext:build` pass at the end.

## Calls I made (the ledger repeats each with "Cost if wrong")

- A writer named but not saved falls back and says so; a save that deletes it sets it to none.
- A local writing AI that isn't the AI in use is never started; a cloud one gets its own lane; a local one shares the main queue.
- The brief and prep task defaults (Medium and Low thinking; 3,072 and 4,096 tokens).
- The caps, 4 characters a token, the 108,000-character request, and fitting the ad on local AIs only.
- A local request over 108,000 even with the ad at its floor is sent up to 120,000, and refused over that with a sentence.
- Writing on Bonsai 2 keeps No limit thinking, best effort, with about 5,700 tokens of room.
- Every note counts, email notes included.
- The brief block's shares: contact 200, opening 450, needs 1,600, gaps 750, answers 1,500; every item kept.
- One shared system part for the four writing tasks; preferences left out of them.
- The resume guide's "can't ask me questions" line changes too.
- A new brief is shown for checking, never written from straight away; "Add to my profile" happens at the main write button.
- `generate` defaults to `'skip'`.
- `profile/.starter-versions.json` and `profile/old-versions/`; no record means an earlier starter.
- The brief's field order and its caps; the quote check is a warning, not a refusal.
- New endpoints that use the writing AI or change the profile are dashboard-only.
- One module, `prep`, for both tables.

## Left to the builder

- Type, helper and endpoint names beyond those above, and the exact shape of the brief and plan contracts.
- How the lanes are built inside the ai service.
- The design-first options and the pick (recorded in the ledger).
- The exact prompt wording, within the rules above.
- How far to batch the work into plan tasks.
