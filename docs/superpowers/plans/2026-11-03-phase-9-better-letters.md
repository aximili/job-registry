# Phase 9: Better Letters, and Getting Ready for a Job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write resumes and cover letters with a chosen writing AI, from a brief you check first, with the job's notes and a contact email the extension used to drop; get a better cover-letter guide onto the user's PC; and make a prep plan for each job.

**Architecture:** `settings.ai` gains `writer`, and the AI service runs the four writing tasks (resume, cover letter, brief, prep plan) on that AI: a cloud writer in a lane of its own, a local one in the main GPU queue, never touching the pill. A budget module in `ai` caps notes, answers, the brief and the job, and fits the ad so every Bonsai 2 request stays under 108,000 characters. A new composite module, `prep`, owns `briefs` and `prep_plans`; `documents.generate` reads the job's notes and the approved brief. The profile module keeps old versions, updates an untouched old starter guide at start-up, and offers a newer one when you've changed yours.

**Tech Stack:** TypeScript (Node runs `.ts` directly), Fastify, better-sqlite3, zod 4, Svelte 5, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-11-03-better-letters-design.md](../specs/2026-11-03-better-letters-design.md). Read it before your task.

## Global Constraints

- **No git writes.** Never `git add`, `commit`, `push`, `stash`, `reset`, `checkout`, `restore`, `tag`, `merge`, `rebase`. Leave edits in the working tree. Reading (`git status`, `git diff`, `git log`, `git show`) is fine.
- **Bash:** never prefix a command with `PATH=…` or `cd … &&`. Never use `curl` or `wget` (use `node -e "fetch(…)"`). Never leave a command running in the background: run long checks in the foreground with a 10-minute timeout.
- **Never read `temp/phase-9-inputs/`** (real personal details), and never copy anything from the real master profile in `~/Downloads` (named in the user's brief) into the repo. Only Task 4 opens that profile, to measure its length, from a script in the ledger folder. Every fixture, test, prompt and guide example uses made-up names and facts (Sam Taylor, Example Co, Alex at example-recruit.com.au).
- **Never touch `data/`, `config/` or `profile/`** in the project root. Tests use temporary folders.
- Plain English and Australian spelling in UI text, docs, comments, errors and prompts. Short sentences.
- TypeScript: erasable syntax only. No `enum`, no constructor parameter properties.
- Architecture rules (AGENTS.md, architecture.md §4 and §15): other modules import only a module's `index.ts`; SQL only in `repo.ts`; Fastify only in `routes.ts`; every API body is a zod schema in `shared/contracts/`; only `server/app.ts` wires modules; `jobs` never depends on `ai`. `npm run check:deps` passes; never weaken a rule. New allowed dependencies: `prep: ['ai', 'profile', 'jobs', 'notes']` and `documents: ['ai', 'profile', 'jobs', 'notes', 'prep']`.
- Database: one new migration, `server/core/db/migrations/007_prep.sql`. Old migrations are never edited.
- Prompts are text files in `server/modules/ai/prompts/`.
- No test calls a real cloud AI. No real model is downloaded or run. Fakes live in `tests/fakes/`.
- Windows scripts touched stay plain ASCII with CRLF.
- **The budget** (`server/modules/ai/budget.ts`): `CHARS_PER_TOKEN = 4`, `REQUEST_TOKENS = 27_000`, `REQUEST_CHARS = 108_000`, `NOTES_CAP = 1_200`, `ANSWER_CAP = 240`, `ANSWERS_CAP = 2_000`, `BRIEF_CAP = 4_500`, `JOB_CAP = 2_000`, `AD_FLOOR = 2_000`, `HARD_CHARS = 120_000`; the ad's cap stays `AD_LIMIT = 12_000` (`tasks/parse-job.ts`). The fit and the hard stop apply to AIs whose preset group is `local` only. A local request over `REQUEST_CHARS` with the ad at its floor is still sent up to `HARD_CHARS`, and refused over it (a `ValidationError`, never an `AiUnavailableError`, so the pill never shows it). The brief block's shares: `contact 200, opening 450, needs 1_600, gaps 750, answers 1_500` (every item kept: a part over its share cuts each item's text evenly with "…"; the resume and the prep plan leave out contact and opening). Every note counts, the email reader's included.
- **Brief caps** (characters, cut, never refused): contact name, email and organisation 120; need 160; story title 80; story text 320; quote 300; quote's why 240; gap 160; gap evidence 240; question 160; question's why 160. Lists: needs 1–3, each need's stories 1–3 (the best, then up to 2 others), gaps up to 5, questions up to 5 from the AI (a new brief carries the previous brief's answered questions first, so a saved brief holds up to 10).
- **Prep caps:** learn topics up to 5, each 2–4 steps; interview questions up to 6; questions to ask up to 5; refresh items up to 8. Text fields 320, steps 200.
- **Task defaults:** `tasks.brief` temperature 0.3, maxTokens 3072, thinking on, effort `medium`; `tasks.prep` temperature 0.4, maxTokens 4096, thinking on, effort `low`.
- **Exact copy:**
  - Settings → AI writing setting: label `Writes your documents`; first option `The AI in use ({name})`; help `Resumes, cover letters, briefs and prep plans. Ratings, quick marks, reading ads and reading emails stay on the AI in use.`
  - Task rows: `Making the brief`, `Making the prep plan`.
  - Writer line: `Writes with {name}`; its change control's accessible name `Change the writing AI`; toast `{name} writes your documents now.` (for "the AI in use": `The AI in use writes your documents now.`).
  - Writer missing: `Your writing AI isn't saved any more, so {name}, the AI in use, writes.`
  - Delete question, added when the AI writes: `{name} also writes your documents. After this, the AI in use writes them.`
  - Brief: heading `Before I write`; parts `Contact`, `Opening line`, `Needs`, `Gaps`, `Questions`; main button `Write the cover letter` / `Write the resume`; `Skip, just write`; `New brief`; `Cancel`; a question's `Skip`; a need's `Drop` / `Bring back`; checkbox `Add to my profile`; recruiter checkbox `From a recruiter`; quote warning `This line isn't word for word in the ad. Check it.`; progress `Waiting for {name}…` then `{name} is making the brief… {m:ss}`.
  - Toast after answers are added: `Added 1 answer to your master profile.` / `Added {n} answers to your master profile.`
  - Profile heading: `## Answers from my applications`. Line: `- {d MMM yyyy}, {role} at {company}: {question} {answer}` (role or company left out when unknown; `{d MMM yyyy}` is `3 Nov 2026`).
  - Get ready: button and heading `Get ready`; parts `Learn in a day`, `A practice project`, `Likely interview questions`, `Questions to ask them`, `Refresh before the interview`; `New plan`; `Earlier plans`; progress `{name} is making your plan… {m:ss}`.
  - Starter note: `A newer starter guide is ready.`; `See what changes`; `Use the new guide`; `Keep mine`; toast `Now using the new {label}. Your old one is kept in the profile folder, under old-versions.` (`{label}` is `cover letter guide` or `resume guide`).
  - Too long for a local AI: `This is too long for {name}: about {n} characters, and it fits about 108,000. Shorten your master profile or your guide, or pick a cloud AI to write (Settings → AI).` (`{n}` with thousands commas, `en-AU`)
  - Errors: `Make a brief first, or press Skip, just write.` (generate with `brief: 'use'` and no brief); `There's a newer brief for this job. Reload the page to see it.` (an edit to a brief that isn't the newest, 409); `There's no saved AI with that id.` (unknown writer id; never quote the id).
  - Prompt notes block: `No notes.` when empty; `(Older notes left out.)` after a cut. Brief block when none: `No brief: plan it yourself, as my guide says.`
- **Full check before you finish a task:** `npm test` (typecheck, svelte-check, check:deps, Vitest). UI tasks (9–12) also run `npm run test:e2e` in the foreground with a 10-minute timeout. If port 4799 is busy, wait; never stop another run.
- **Design-first** (Tasks 9–12): follow `.claude/skills/design-first/SKILL.md`, but the user is away: build two or three real options (temporary `DESIGN_OPTION` constant), shoot each in both themes and both widths into `temp/design-first/phase-9/`, then **stop and report** the screenshot paths. The controller picks; you then build the pick, delete the other options, and shoot `after`.

## Review Focus

1. **The user's Windows guide is an old starter with CRLF line endings** (Git for Windows checks `.md` out that way). It must be updated at start-up, its old text kept; a guide one character different must never be replaced. Test in Task 6 with CRLF copies of the old starters.
2. **An edit lands on an old brief.** Two tabs, or a "New brief" while a PATCH is in flight: an edit to a brief that isn't the job's newest gets 409, and the editor reloads on `brief.saved`. Test in Task 7.
3. **"Add to my profile" twice.** A double click, or writing twice with the same brief, adds each answer once; an answer changed after it was added is added again as a new dated line. Test in Task 7.
4. **The writing AI changes or is deleted while a brief or draft runs.** The running task finishes on the AI it started on, and its `by` names that AI; the next one uses the new writer or falls back. Test in Task 3.
5. **The worst case on Bonsai 2.** A made-up 86,000-character profile, every note and answer at its cap, a 20,000-character ad: every writing request is 108,000 characters or fewer on a local AI, and a cloud writer gets the ad up to 12,000. Test in Task 4.

---

### Task 1: The writing AI in settings, and the two new task blocks

**Files:**
- Modify: `shared/contracts/ai.ts` (`writer`, `writingAi`, `tasks.brief`, `tasks.prep`), `shared/contracts/settings.ts` (`UseWriterRequest`)
- Modify: `server/modules/settings/service.ts`, `routes.ts`; `shared/api-client.ts` (`useWriter`)
- Modify: `config/settings.example.json` only if its test needs it
- Test: `shared/contracts/contracts.test.ts`, `server/modules/settings/service.test.ts`, `server/modules/settings/routes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // in StrictAiSettings: writer: AiId.nullable().default(null)   (not refined to name a saved AI)
  function writingAi(ai: AiSettings): { ai: SavedAi; inUse: boolean; missing: boolean }
  // SavedAi.tasks gains brief and prep (TaskSettings, with the Global Constraints' defaults)
  UseWriterRequest = z.strictObject({ id: AiId.nullable() })
  SettingsService.useWriter(id: string | null): Settings   // ValidationError "There's no saved AI with that id." for an unknown id
  // PUT /api/v1/settings/ai/writer, dashboardOnly('Only the dashboard can change settings.'), answers Settings
  ApiClient.useWriter(id: string | null): Promise<Settings>
  ```

- [ ] **Step 1: Write the failing contract tests:** `Settings.parse({}).ai.writer === null`; an old flat file parses with `writer: null`; `writingAi` returns the AI in use with `inUse: true, missing: false` for `null`, the named AI with `inUse: false` when it's another, `inUse: true` when it names the AI in use, and the AI in use with `missing: true` for an id that isn't saved; `SavedAi` defaults give `tasks.brief` `{ temperature: 0.3, maxTokens: 3072, thinking: true, thinkingEffort: 'medium' }` and `tasks.prep` `{ temperature: 0.4, maxTokens: 4096, thinking: true, thinkingEffort: 'low' }`; a `writer` with upper case is refused.
- [ ] **Step 2: Run** `npx vitest run shared/contracts`. Expected: FAIL.
- [ ] **Step 3: Implement the contracts.**
- [ ] **Step 4: Write the failing service and route tests:** `useWriter('claude-mine')` saves `writer`, emits `settings.changed` with `keys: ['ai']`; `useWriter(null)` clears it; `useWriter('nope')` throws the exact sentence, without the id, and changes nothing; `update({ ai })` that deletes the writing AI saves `writer: null`; `update({ ai })` whose `writer` names no saved AI saves `null`; the route refuses an extension origin and works for the dashboard.
- [ ] **Step 5: Implement**, run `npx vitest run server/modules/settings shared`. Expected: PASS.
- [ ] **Step 6: Run** `npm test`. Expected: all pass.

### Task 2: Keep a `mailto:` address the link's text hides

**Files:**
- Modify: `extension/src/text.ts` (`walk`), `server/core/html-text.ts` (`nodeText`), `server/modules/ai/prompts/parse-job.md` (the `adContact` line)
- Create: `tests/fixtures/mailto-cases.ts` (the shared table)
- Test: `extension/src/text.test.ts` (new), `server/core/html-text.test.ts`, `extension/src/sites/sites.test.ts` (a Seek ad with a masked link)

**Interfaces:**
- Produces: `MAILTO_CASES: { html: string; text: string }[]` in `tests/fixtures/mailto-cases.ts`, read by both readers' tests.

- [ ] **Step 1: Write the table and the failing tests.** Cases (made up), each html → text:
  - `<a href="mailto:Alex@example-recruit.com.au">••••@example-recruit.com.au</a>` → `••••@example-recruit.com.au (Alex@example-recruit.com.au)`
  - `<a href="mailto:jobs@example.com">jobs@example.com</a>` → `jobs@example.com`
  - `<a href="mailto:JOBS@example.com">jobs@example.com</a>` → `jobs@example.com` (case ignored)
  - `<a href="mailto:alex@example.com?subject=Role">email Alex</a>` → `email Alex (alex@example.com)`
  - `<a href="mailto:alex%40example.com"></a>` → `alex@example.com`
  - `<a href="mailto:">Email us</a>` and `<a href="mailto:nobody">Email us</a>` → `Email us`
  - `<a href="https://example.com">Apply</a>` → `Apply`
  - a paragraph around a masked link keeps the words before and after it.
  In `sites.test.ts`, a made-up Seek job page whose description has the masked link: `extract(...).jdText` contains `Alex@example-recruit.com.au`.
- [ ] **Step 2: Run** `npx vitest run extension/src/text.test.ts server/core/html-text.test.ts extension/src/sites`. Expected: FAIL.
- [ ] **Step 3: Implement** the rule from spec B1 in both readers (an `A` element with an `href` starting `mailto:`, case-insensitive). Change `parse-job.md`'s `adContact` line to: `adContact: when the ad gives a person or an address to contact. Copy their name, email and phone as written. When a link's text hides an address, the address in brackets after it is the real one: use that.`
- [ ] **Step 4: Run** the same tests, then `npm test`. Expected: PASS.

### Task 3: The writing AI's routing and the lanes

**Files:**
- Modify: `server/modules/ai/queue.ts` (`cancelKey`), `server/modules/ai/service.ts`, `server/app.ts` (`getWriter`, keeping the writer's provider)
- Test: `server/modules/ai/queue.test.ts`, `server/modules/ai/writer.test.ts` (new), `tests/fakes/` as needed (a `providerFor` that gives each AI its own `FakeAiProvider`)

**Interfaces:**
- Consumes: `writingAi` (Task 1).
- Produces:
  ```ts
  AiQueue.cancelKey(key: string): void          // cancels a waiting or running task with that key
  AiOptions.getWriter: () => { ai: SavedAi; inUse: boolean }
  // internal to the service, used by writeDocument now and by briefJob/prepJob in Task 4:
  function writing<T>(key: string | undefined, signal: AbortSignal | undefined,
                      work: (signal: AbortSignal, ai: SavedAi, provider: AiProvider) => Promise<T>,
                      o?: { onStart?: (ai: SavedAi) => void }): Promise<T>
  ```
  `writing` picks the writer when the task is queued: the AI in use → `run('interactive', …)` as today (and at the start it re-reads `getWriter()`: if that's now another AI, it runs on that one without touching the pill); another local AI → the main queue at `interactive`, with the writer's provider, a `health()` check (not ok → `AiUnavailableError` with the provider's own sentence) and the model-file check, never `useRuntime`, `ensureRunning`, `busy`, `failure` or `publish`; another cloud AI → that AI's lane (`createAiQueue()` per AI id, made on first use), same work, nothing on the pill. Every keyed task first cancels that key in every other lane. `stop()`, `stopNow()` and `onIdle()` cover every lane. `onStart` is called with the AI the task runs on, when its work starts.

- [ ] **Step 1: Write the failing queue test:** `cancelKey('k')` rejects a waiting task with that key (AbortError) and aborts a running one; other keys carry on.
- [ ] **Step 2: Write the failing writer tests** in `writer.test.ts`, with three saved AIs (Bonsai 2 local in use, "Bonsai light" local, "Claude – mine" cloud with a key), each with its own fake provider:
  - with `writer: null`, `writeDocument` goes to Bonsai 2's provider, as today.
  - with the writer Claude: `writeDocument` goes to Claude's provider with Claude's `tasks.write` settings; `rateJob` still goes to Bonsai 2.
  - a Claude draft runs while a slow Bonsai 2 rating holds the main queue (both providers have a call at the same time).
  - a Claude failure (`AiAccountError` "Claude – mine refused its API key. …") rejects the draft, and `status()` stays `ready` with no detail; no `ai.stateChanged` with `error` is sent.
  - with the writer Bonsai light (local, not in use) whose `health()` says not ok: the draft fails with that sentence, the runtime's `ensureRunning` is never called for it, and the pill is unchanged.
  - **Review Focus 4:** the writer changes while a Claude draft runs: the draft finishes on Claude; the next one goes to the new writer. With a writer id that's no longer saved, the draft runs on the AI in use.
  - latest wins across lanes: a draft with key `doc-1-resume` on Claude, then the writer becomes Bonsai 2 and a second draft with the same key starts: the first is cancelled.
  - `stop()` cancels a running Claude draft.
- [ ] **Step 3: Run** `npx vitest run server/modules/ai`. Expected: FAIL.
- [ ] **Step 4: Implement** `cancelKey`, `writing`, and `writeDocument` through it. In `app.ts`: `getWriter: () => { const w = writingAi(settings.service.get().ai); return { ai: w.ai, inUse: w.inUse }; }`, and `providerFor` keeps the writing AI's provider as it keeps the AI in use's (by id; only the saved object; dropped on `settings.changed` with `ai`).
- [ ] **Step 5: Run** `npx vitest run server/modules/ai`, then `npm test`. Expected: PASS.

### Task 4: The budget, the writing prompts, and the brief and prep tasks

**Files:**
- Create: `shared/contracts/prep.ts` (exported from `index.ts`): the AI answers and the writer's brief
- Create: `server/modules/ai/budget.ts`, `server/modules/ai/tasks/make-brief.ts`, `server/modules/ai/tasks/make-prep.ts`
- Create: `server/modules/ai/prompts/make-brief.md`, `make-prep.md`; rewrite `write-resume.md`, `write-cover-letter.md`
- Modify: `server/modules/ai/tasks/write-document.ts`, `server/modules/ai/service.ts`, `server/modules/ai/index.ts`
- Modify: `tests/fakes/smart-fake-ai.ts`, `tests/fakes/fake-ai-provider.ts` (answers for `brief` and `prep_plan`; resume or cover letter told apart by the **user** part's first line, since the system parts now match)
- Create (not tracked): `.superpowers/sdd/2026-11-03-phase-9-better-letters/measure.ts`
- Test: `server/modules/ai/budget.test.ts`, `server/modules/ai/prompts.test.ts`, `server/modules/ai/tasks/tasks.test.ts`, `server/modules/ai/write.test.ts`

**Interfaces:**
- Produces (`shared/contracts/prep.ts`):
  ```ts
  Story = { title: string; text: string }
  BriefAnswer   // the AI's JSON (schema name 'brief'), in this order:
    { contact: { name: string|null; email: string|null; recruiter: boolean; organisation: string|null };
      needs: { need: string; story: Story; others: Story[] }[];      // 1–3, others ≤ 2
      opening: { quote: string; why: string };
      gaps: { mustHave: string; evidence: string }[];                 // ≤ 5
      questions: { question: string; why: string }[] }                // ≤ 5
  PrepAnswer    // the AI's JSON (schema name 'prep_plan'):
    { learn: { topic: string; why: string; steps: string[]; hours: number; afterwards: string }[];   // ≤ 5, steps 2–4, hours 0.25–8
      project: { title: string; what: string; touches: string[]; hours: number; afterwards: string };
      interview: { question: string; story: string }[];               // ≤ 6
      ask: { question: string; why: string }[];                       // ≤ 5
      refresh: { item: string; why: string }[] }                      // ≤ 8
  WriterBrief   // the approved brief as a writer gets it
    { contact: BriefAnswer['contact']; opening: { quote: string; why: string };
      needs: { need: string; story: Story }[]; gaps: BriefAnswer['gaps']; answers: { question: string; answer: string }[] }
  JobNote = { at: string /* ISO */; text: string }
  ```
  The schemas give JSON Schema `maxItems` for the lists (a preprocess cuts a longer list first, so zod never refuses it) and no `maxLength`; text is cut to the caps after parsing.
- Produces (`budget.ts`): the constants in Global Constraints, and
  ```ts
  notesBlock(notes: JobNote[]): string                     // newest first as given; "3 Nov 2026: …"; ≤ NOTES_CAP
  answersBlock(answers: { question: string; answer: string }[]): string   // ≤ ANSWERS_CAP
  briefBlock(brief: WriterBrief | null, kind: 'resume' | 'cover_letter' | 'prep'): string   // ≤ BRIEF_CAP, each part within its share; resume and prep leave out contact and opening
  checkSize(chars: number, local: boolean, name: string): void   // throws the "too long" ValidationError over HARD_CHARS on a local AI
  capJob(job: string): string                              // ≤ JOB_CAP
  fitAd(ad: string, otherChars: number, local: boolean): string   // local: min(AD_LIMIT, max(AD_FLOOR, REQUEST_CHARS − otherChars)); cloud: trimAd
  cutBrief(answer: BriefAnswer, ad: string): BriefAnswer & { opening: { inAd: boolean } }
  cutPrep(answer: PrepAnswer): PrepAnswer                  // also removes http://, https:// and www. links from every text
  ```
- Produces (`AiService`):
  ```ts
  WriteInput = { kind; profile; guide; job; ad; today; notes: JobNote[]; brief: WriterBrief | null }
  BriefInput = { profile: string; job: string; ad: string; notes: JobNote[]; answers: { question: string; answer: string }[]; today: string }
  PrepInput  = { profile: string; job: string; ad: string; notes: JobNote[]; brief: WriterBrief | null; today: string }
  briefJob(input: BriefInput, o?: { signal?: AbortSignal; key?: string; onStart?: (by: string) => void }):
    Promise<{ brief: ReturnType<typeof cutBrief>; by: string }>     // by: the name of the AI it ran on
  prepJob(input: PrepInput, o?: { signal?: AbortSignal; key?: string; onStart?: (by: string) => void }): Promise<{ plan: PrepAnswer; by: string }>
  ```
  Both run through `writing` (Task 3) with `tasks.brief` and `tasks.prep`, through `runJsonTask`.

- [ ] **Step 1: Write the failing budget tests** (`budget.test.ts`): each cap (a note list over 1,200 characters keeps whole newest notes, cuts the crossing one with `…`, ends with `(Older notes left out.)`; an empty list gives `No notes.`); `answersBlock` ≤ 2,000 with five 240-character answers; `briefBlock` ≤ 4,000 with every field at its cap, each part within its share (needs ≤ 1,450, gaps ≤ 800, answers ≤ 1,150, contact ≤ 200, opening ≤ 400), leaves out dropped needs (they never reach `WriterBrief`), and leaves out contact and opening for `resume` and `prep`; `briefBlock(null, …)` is `No brief: plan it yourself, as my guide says.`; `fitAd` on local with `otherChars` 100,000 gives 8,000 characters plus the cut line, with 107,000 gives 2,000 plus the cut line, and on cloud gives 12,000; `cutBrief` cuts four needs to three, a 500-character story to 320, and sets `inAd` true for a quote that's in the ad with other spaces and case, false otherwise; `cutPrep` removes `https://example.com/course` and `www.example.com` from a step.
- [ ] **Step 2: Write the failing prompt tests** (`prompts.test.ts`): the system parts of `make-brief`, `make-prep`, `write-resume` and `write-cover-letter` are the same, word for word, contain `{{profile}}` and none of `{{ad}}`, `{{guide}}`, `{{notes}}`, `{{brief}}`; each user part has `{{notes}}`, and the two write prompts and `make-prep` have `{{brief}}`.
- [ ] **Step 3: Write the failing task tests:**
  - **Review Focus 5:** with a made-up profile of 86,000 characters, five notes over the cap, five answers at 240, a `WriterBrief` with every field at its cap, a job text of 3,000 characters and an ad of 20,000: for each of `briefJob`, `prepJob`, `writeDocument('resume')` and `writeDocument('cover_letter')` on a local AI (the real starter guides from `starters/profile/`), the system plus user message is ≤ 108,000 characters; on a cloud AI the ad in the request is 12,000 characters plus the cut line. With a 100,000-character profile on a local AI, a resume with a brief (about 121,000) is refused with the exact "too long" sentence, nothing is sent, and `status()` is unchanged; a 95,000-character profile (about 116,000) is sent; on a cloud AI neither is refused.
  - `briefJob` sends schema name `brief` with `tasks.brief`'s settings and returns the cut answer with `by` the AI's name; `prepJob` the same with `prep_plan` and `tasks.prep`; `writeDocument` with a brief and notes puts both blocks into the user message.
  - `onStart` is called once, with the AI's name, when the work begins.
- [ ] **Step 4: Run** `npx vitest run server/modules/ai`. Expected: FAIL.
- [ ] **Step 5: Write the prompts.** The shared system part: who I am to the AI (you help me with my job applications); facts only from my master profile, my notes on this job and my answers; never invent employers, titles, dates, numbers, results, skills or certifications; never claim anything my profile says not to claim, and use the conservative value for ⚠ items; Australian spelling; then `My master profile:` and `{{profile}}`. Each user part holds its task's rules, then the job, the notes (`My notes on this job, newest first. They're mine: treat them as true, and follow any wishes in them.`), the brief or earlier answers, the guide (write tasks), and the ad last. `make-brief.md` carries spec C's rules for each part; `make-prep.md` spec D's five parts, no links or URLs, nothing about the employer the ad doesn't say. No real names: Sam Taylor and Example Co only, if an example is needed at all.
- [ ] **Step 6: Implement** the contracts, `budget.ts`, the two task files, `write-document.ts` with notes and brief, the two service methods, and the fakes (made-up answers that pass the schemas; see `E2E_PROFILE`).
- [ ] **Step 7: Run** `npx vitest run server/modules/ai shared`, then `npm test`. Expected: PASS.
- [ ] **Step 8: Measure the real worst case.** Write `measure.ts` in the ledger folder: it takes the profile's path as an argument, builds each of the four requests with the real prompt files and starter guides and every cap full (as in the Step 3 test), and prints each request's characters and `chars / 4`. Run `node .superpowers/sdd/2026-11-03-phase-9-better-letters/measure.ts <path>`, where `<path>` is the real master profile in `~/Downloads` (named in the user's brief). Expected: every request ≤ 108,000 characters. Put the four numbers in your report. If one is over, trim the prompt's own words first, then lower a cap, and say which.

### Task 5: The new cover-letter guide

**Files:**
- Modify: `starters/profile/cover-letter-guide.md`; one line of `starters/profile/resume-guide.md`
- Create: `tests/starter-guides.test.ts`

- [ ] **Step 1: Write the failing tests:** the cover-letter guide has 1,441 words or fewer (split on whitespace); it still has `250 to 400 words`; it has none of `You can't ask me questions here`, `Never skip the plan`; it says a first name in the contact's email counts as their name, that a recruiter's ad is written to the recruiter, to open with the ad's most telling line in its own words, never to restate the skills list, one short story per need, a missing must-have near the end before the close with no stock plan, contractions (`I'm`, `I've`, `I'd`), that my answers and the approved brief are facts from me, and that an approved brief replaces Step 1 (assert a short phrase for each that your wording keeps); the resume guide has the answers-and-brief line in place of its "can't ask me questions" line and is no longer than 1,871 words; **no real names:** no word or two-word run (lower case, letters and digits only) in either guide, in `server/modules/ai/prompts/*.md`, or in `tests/fixtures/` text files has a SHA-256 in the test's list of hashes (the controller gives you the list; it holds no names).
- [ ] **Step 2: Run** `npx vitest run tests/starter-guides.test.ts`. Expected: FAIL.
- [ ] **Step 3: Rewrite the guide** per spec B3. Replace and shorten lines; don't add sections. Every example is made up.
- [ ] **Step 4: Run** the test, then `npm test`. Expected: PASS (the e2e guide fixture copies are made from `starters/` at start, so nothing else changes).

### Task 6: Old versions, starter updates, and answers in the profile

**Files:**
- Create: `server/modules/profile/starters.ts` (`STARTER_HISTORY`, `normaliseStarter`), `shared/line-diff.ts`
- Modify: `server/modules/profile/service.ts`, `routes.ts`, `index.ts`; `shared/contracts/profile.ts`; `shared/api-client.ts`; `server/app.ts` (`syncStarters`)
- Create: `tests/fixtures/starters/` (the three earlier versions of each guide, copied from `git show <commit>:starters/profile/<name>.md`: 67c19c5, 5ac1b81, 75011e0)
- Test: `server/modules/profile/profile.test.ts`, `server/modules/profile/routes.test.ts` (new if missing), `shared/line-diff.test.ts`, `tests/starter-history.test.ts`

**Interfaces:**
- Produces:
  ```ts
  GuideName = z.enum(['resume-guide', 'cover-letter-guide'])
  DiffLine = { kind: 'same' | 'removed' | 'added'; text: string }
  lineDiff(from: string, to: string): DiffLine[]                       // shared/line-diff.ts, LCS by line, after normaliseStarter-style \r\n → \n
  StarterStatus = { name: GuideName; state: 'same' | 'newer' | 'yours'; diff: DiffLine[] | null }   // diff only for 'newer'
  StarterActionRequest = z.strictObject({ action: z.enum(['use', 'keep']) })
  ProfileService.syncStarters(): { copied: ProfileFileName[]; updated: ProfileFileName[] }      // replaces installStarters
  ProfileService.starters(): StarterStatus[]
  ProfileService.useStarter(name: GuideName): ProfileFile
  ProfileService.keepStarter(name: GuideName): StarterStatus
  ProfileService.appendAnswers(lines: string[]): ProfileFile           // under "## Answers from my applications"
  // GET /api/v1/profile/starters → StarterStatus[];  POST /api/v1/profile/:name/starter { action } → ProfileFile (use) or StarterStatus (keep), dashboard-only
  ApiClient.starters(), ApiClient.starterAction(name, action)
  ```
  `normaliseStarter(text)`: drop a byte-order mark, `\r\n` and `\r` → `\n`. `STARTER_HISTORY[name]` holds the full SHA-256 hex of each earlier version's normalised text. What you've seen: `profile/.starter-versions.json` `{ "<name>": "<sha256 of the starter seen>" }`. Old text: `profile/old-versions/<name>-<YYYY-MM-DD-HHMMSS>.md` (local time, `-2`, `-3` … if taken), written before any replace or append.

- [ ] **Step 1: Write the failing tests:**
  - `lineDiff`: equal texts are all `same`; one changed line is a `removed` then an `added`; CRLF in one side doesn't count as a change.
  - **Review Focus 1:** a guide that's each earlier version (from `tests/fixtures/starters/`), with CRLF line endings, is replaced at `syncStarters()` (it's in `updated`), its old text is in `old-versions/`, and `.starter-versions.json` records the current starter; the same text with one character changed is left alone and not in `updated`.
  - a missing guide is copied in and recorded (as today's `installStarters` test, renamed).
  - `starters()`: your guide equal to the current starter → `same`; changed with no record → `newer` with a diff whose `added` lines are the starter's; after `keepStarter` → `yours`; after `useStarter` → `same`, the old text kept, `profile.changed` emitted.
  - `appendAnswers(['- a', '- b'])` on a profile without the heading adds a blank line, the heading and both lines at the end; on a profile with the heading in the middle, adds them at the end of that section, before the next `##` heading; everything else is byte for byte the same; a copy of the old profile is in `old-versions/`; `profile.changed` is emitted.
  - `tests/starter-history.test.ts` (skipped when `git` isn't available): for each guide, every committed version (`git log --format=%H -- starters/profile/<name>.md`, then `git show`) whose normalised hash isn't the working file's is in `STARTER_HISTORY`, and the working file's hash isn't.
  - the routes: `GET /profile/starters` answers; the POST refuses an extension origin; an unknown name is 404.
- [ ] **Step 2: Run** `npx vitest run server/modules/profile shared/line-diff.test.ts tests/starter-history.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and switch `app.ts` to `syncStarters()`, logging `Added starter files: …` and `Updated the starter guide: …`.
- [ ] **Step 4: Run** the same tests, then `npm test`. Expected: PASS.

### Task 7: The prep module's briefs, and `generate` with notes and the brief

**Files:**
- Create: `server/core/db/migrations/007_prep.sql`, `server/modules/prep/{index,service,repo,routes}.ts`, `server/modules/prep/prep.test.ts`, `server/modules/prep/routes.test.ts`
- Modify: `shared/contracts/prep.ts` (saved `Brief`, `BriefEdits`, `BriefLine`), `shared/contracts/documents.ts` (`GenerateRequest.brief`), `server/core/events.ts` (`brief.saved`), `server/modules/live/` (forward it), `server/modules/documents/{service,routes,index}.ts`, `server/app.ts`, `.dependency-cruiser.cjs`, `shared/api-client.ts`
- Test: `server/modules/documents/generate.test.ts`, `tests/architecture/` if it lists modules

**Interfaces:**
- Consumes: `briefJob`, `WriterBrief`, `JobNote` (Task 4); `appendAnswers` (Task 6).
- Produces:
  ```sql
  -- 007_prep.sql
  CREATE TABLE briefs (id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id), brief_json TEXT NOT NULL,
    made_by TEXT, approved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX briefs_job ON briefs(job_id, id);
  CREATE TABLE prep_plans (id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id), plan_json TEXT NOT NULL,
    made_by TEXT, created_at TEXT NOT NULL);
  CREATE INDEX prep_plans_job ON prep_plans(job_id, id);
  ```
  ```ts
  Brief = { id; jobId; by: string | null; createdAt; updatedAt; approvedAt: string | null;
            contact: { name; email; recruiter; organisation };
            opening: { quote: string; why: string; inAd: boolean };
            needs: { need: string; stories: Story[]; chosen: number; dropped: boolean }[];
            gaps: { mustHave: string; evidence: string }[];
            questions: { question: string; why: string; answer: string | null; skipped: boolean; addToProfile: boolean; addedAt: string | null }[] }
  BriefEdits = z.strictObject({                                  // each list, when sent, has the brief's own length
    contact: z.strictObject({ name: z.string().trim().max(120).nullable(), recruiter: z.boolean() }).optional(),
    needs: z.array(z.strictObject({ chosen: z.number().int().min(0).max(2), dropped: z.boolean() })).max(3).optional(),
    questions: z.array(z.strictObject({ answer: z.string().trim().max(240).nullable(), skipped: z.boolean(), addToProfile: z.boolean() })).max(5).optional() })
  BriefLine = { kind: 'waiting' } | { kind: 'working'; by: string } | { kind: 'done'; brief: Brief } | { kind: 'error'; message: string }
  GenerateRequest = z.strictObject({ kind: DocumentKind, brief: z.enum(['use', 'skip']).default('skip') })
  PrepService.brief(jobId: number): Brief | null
  PrepService.makeBrief(jobId: number, o: { signal: AbortSignal; onLine: (line: BriefLine) => void }): Promise<Brief>
  PrepService.editBrief(id: number, edits: BriefEdits): Brief
  PrepService.approvedBrief(jobId: number): WriterBrief | null      // marks the newest approved
  PrepService.addAnswersToProfile(id: number): { added: number }
  // events: 'brief.saved': { jobId: number; briefId: number }
  // routes: GET /jobs/:id/brief → { brief: Brief | null }; POST /jobs/:id/brief (NDJSON BriefLine, dashboard-only);
  //         PATCH /briefs/:id (dashboard-only) → Brief; POST /briefs/:id/answers-to-profile (dashboard-only) → { added: number };
  //         POST /jobs/:id/documents/generate becomes dashboard-only too
  ApiClient.getBrief(jobId), makeBrief(jobId, { signal }): AsyncIterable<BriefLine>, editBrief(id, edits), addAnswersToProfile(id),
  ApiClient.generateDocument(jobId, kind, { signal, brief?: 'use' | 'skip' })
  ```
  `makeBrief` refuses before the stream: a missing job (404), no master profile (400, `NO_PROFILE`). Its `answers` input is the previous brief's answered questions. A saved brief's need has its `stories` as `[story, ...others]` and `chosen: 0`. The job text for the AI is `describeJob(job)` (move it where both `documents` and `prep` can use it: `shared/` as a pure helper). An answer changed after it was added clears its `addedAt`. A brief edit with a list of the wrong length, or a `chosen` past its stories, is a `ValidationError`.

- [ ] **Step 1: Write the failing tests** (`prep.test.ts`, through `buildApp` with fakes and `:memory:`):
  - `makeBrief` saves a row, sends `waiting`, then `working` with the writer's name, then `done`; `brief.saved` is emitted; `brief(jobId)` is the newest; a second `makeBrief` keeps the first row and passes its answered questions to the AI (they're in the request's user part).
  - `editBrief`: the contact's name and recruiter, `chosen` and `dropped`, an answer and `skipped`; a wrong-length list and a `chosen` of 2 for a need with two stories are refused.
  - **Review Focus 2:** after a second brief, an edit to the first is a 409 with the exact sentence.
  - **Review Focus 3:** `addAnswersToProfile` adds one line per ticked, answered, not-yet-added question, in the exact format; called twice, it adds nothing the second time; after an answer changes, it's added again as a new line; skipped and unticked ones are never added.
  - `approvedBrief` gives the chosen stories, leaves out dropped needs and unanswered or skipped questions, and sets `approvedAt`.
  - `generate.test.ts`: `brief: 'use'` puts the brief block and the notes block into the request; `'skip'` puts the notes and `No brief: …`; `'use'` with no brief is the exact 400; the default is `'skip'`.
  - `routes.test.ts`: the NDJSON lines; each write refuses an extension origin; 404 and 400 before the stream.
- [ ] **Step 2: Run** `npx vitest run server/modules/prep server/modules/documents`. Expected: FAIL.
- [ ] **Step 3: Implement**, with the allow-list change in `.dependency-cruiser.cjs`, and wire `prep` in `app.ts` before `documents`.
- [ ] **Step 4: Run** `npx vitest run server/modules/prep server/modules/documents`, then `npm test`. Expected: PASS, `check:deps` clean.

### Task 8: Prep plans

**Files:**
- Modify: `shared/contracts/prep.ts` (`PrepPlan`, `PrepLine`), `server/modules/prep/{service,repo,routes}.ts`, `server/core/events.ts` (`prep.saved`), `server/modules/live/`, `shared/api-client.ts`
- Test: `server/modules/prep/prep.test.ts`, `server/modules/prep/routes.test.ts`

**Interfaces:**
- Consumes: `prepJob` (Task 4), `approvedBrief`-style building of a `WriterBrief` (Task 7; for the plan, read the newest brief without marking it approved).
- Produces:
  ```ts
  PrepPlan = PrepAnswer & { id: number; jobId: number; by: string | null; createdAt: string }
  PrepLine = { kind: 'waiting' } | { kind: 'working'; by: string } | { kind: 'done'; plan: PrepPlan } | { kind: 'error'; message: string }
  PrepService.plans(jobId: number): PrepPlan[]                       // newest first
  PrepService.makePlan(jobId: number, o: { signal: AbortSignal; onLine: (line: PrepLine) => void }): Promise<PrepPlan>
  // event 'prep.saved': { jobId; planId }; routes: GET /jobs/:id/prep → { plans: PrepPlan[] }; POST /jobs/:id/prep (NDJSON, dashboard-only)
  ApiClient.prepPlans(jobId), makePrepPlan(jobId, { signal }): AsyncIterable<PrepLine>
  ```

- [ ] **Step 1: Write the failing tests:** `makePlan` saves a plan with the writer's name and sends the lines; a second keeps the first and `plans()` is newest first; the request has the notes, and the newest brief's needs, gaps and answers when there's a brief, and `No brief: …` when not; a plan whose step has a URL is saved without it; no profile is a 400 before the stream; the POST refuses an extension origin.
- [ ] **Step 2: Run** `npx vitest run server/modules/prep`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run server/modules/prep`, then `npm test`. Expected: PASS.

**Checkpoint review after Task 8:** the whole server side (Tasks 1–8) gets one review before any UI work.

### Task 9: Settings → AI: the writing AI and the two task rows (design-first)

**Files:**
- Modify: `web/src/components/AiSettingsSection.svelte` and/or `AiList.svelte`, `web/src/lib/ai-tasks.ts` (`TASK_ROWS`), `web/src/lib/ai-list.ts` if the delete question lives there
- Modify: `.claude/skills/design-first/shoot.ts` (a `writer` page if `settings` doesn't show the setting)
- Test: `web/src/lib/ai-tasks.test.ts`, `tests/e2e/ai-switch.spec.ts` (or a new `writer.spec.ts`)

- [ ] **Step 1: Shoot `before`** (`--pages settings,ai-cloud`), into `temp/design-first/phase-9/task-9/`.
- [ ] **Step 2: Build two or three options** for where the writing setting sits and how it reads (for example: a line above My AIs; a "Writes your documents" tag on the AI in My AIs with a Make it write action; a field in the form), shoot each, and **stop and report** the paths, each option's idea and trade-off, and your recommendation.
- [ ] **Step 3: After the controller's pick,** build it: the setting saves at once (`api.useWriter`), shows the exact copy, the fallback sentence when `missing`, and the delete question's added sentence. Add `brief` and `prep` to `TASK_ROWS` with the exact labels (a failing test first). Delete the other options.
- [ ] **Step 4: Write the e2e test** (failing first): pick Claude – mine as the writer from Settings → AI, reload, it's still picked; pick "The AI in use" again; by keyboard alone.
- [ ] **Step 5: Run** `npm test` and `npm run test:e2e`. Expected: PASS. Shoot `after`.

### Task 10: The editor's "Before I write" (design-first)

**Files:**
- Create: `web/src/components/BriefPanel.svelte`, `web/src/components/WriterLine.svelte` (the writer's name and the one-click change; reused in Task 11), `web/src/lib/brief.ts` (pure helpers: the edits for a change, the progress text) with `brief.test.ts`
- Modify: `web/src/pages/DocEditorPage.svelte` (the brief, the three buttons, the fact-check's extra sources: the brief's answers and the job's notes), `web/src/lib/live.svelte.ts` (`brief.saved`), `.claude/skills/design-first/shoot.ts` (a `brief` page: the editor with a made-up brief; and the brief being made), `tests/e2e/serve.ts` if the fake needs a mode
- Test: `tests/e2e/brief.spec.ts` (new), `tests/e2e/documents.spec.ts` (the old Generate flow)

- [ ] **Step 1: Shoot `before`** (`--pages editor`).
- [ ] **Step 2: Build two or three options** for the brief beside the editor (for example: a column to the left of the text; a card above the panes that folds to one line once written; a step that replaces the panes until you write), each with the writer line, the progress line with Cancel, the three buttons, and every control in spec C. Shoot each in both themes and widths, with a brief and while one is being made, and **stop and report**.
- [ ] **Step 3: After the pick,** build it: the main button makes a brief when the job has none, or adds the ticked answers (`addAnswersToProfile`, with the toast) and writes with `brief: 'use'`; `Skip, just write` writes with `'skip'` (and cancels a brief being made); `New brief`; Cancel; each edit saves at once (`editBrief`) and reloads on a 409; the quote warning; the focus moves to the brief's heading when it's done; progress is `aria-live`. The writer line's change menu works by keyboard as the AI pill's does (§10). Delete the other options.
- [ ] **Step 4: Write the e2e tests** (failing first): make a brief, swap a story, drop a need, answer one question and skip another, tick Add to my profile, write the cover letter (the master profile gains the line; the toast says so); Skip, just write; New brief; Cancel while making; change the writing AI from the writer line; the whole flow by keyboard alone; the old Generate tests still pass.
- [ ] **Step 5: Run** `npm test` and `npm run test:e2e`. Expected: PASS. Shoot `after`, and measure contrast for every new colour pair in both themes (4.5:1 text, 3:1 edges).

### Task 11: The job page's "Get ready" (design-first)

**Files:**
- Create: `web/src/components/PrepPanel.svelte`
- Modify: `web/src/pages/JobPage.svelte`, `web/src/lib/live.svelte.ts` (`prep.saved`), `.claude/skills/design-first/shoot.ts` (a `prep` page: the job page with a made-up plan)
- Test: `tests/e2e/prep.spec.ts` (new)

- [ ] **Step 1: Shoot `before`** (`--pages job`).
- [ ] **Step 2: Build two or three options** for where "Get ready" and the plan sit and how the five parts read (for example: a section under Documents; a tab beside Documents; a panel beside the call sheet), each with the writer line and the progress line. Shoot, and **stop and report**.
- [ ] **Step 3: After the pick,** build it: Get ready, New plan, Earlier plans by date (any one opens), Cancel, the focus to the plan's heading when done. The call sheet stays the boldest thing at the top. Delete the other options.
- [ ] **Step 4: Write the e2e tests** (failing first): Get ready makes a plan and shows its five parts; New plan keeps the old one under Earlier plans; Cancel; by keyboard alone.
- [ ] **Step 5: Run** `npm test` and `npm run test:e2e`. Expected: PASS. Shoot `after`; measure contrast.

### Task 12: Settings → Profile's starter note (design-first)

**Files:**
- Modify: `web/src/components/ProfileFilesSection.svelte` (or a new `StarterNote.svelte`), `.claude/skills/design-first/shoot.ts` (a `starter` page: Settings → Profile with a changed guide)
- Test: `tests/e2e/profile.spec.ts`

- [ ] **Step 1: Shoot `before`** (Settings → Profile).
- [ ] **Step 2: Build two or three options** for the note and the diff (for example: a banner above the guide's editor with the diff folded; a side-by-side old and new; a dialog), shoot, and **stop and report**.
- [ ] **Step 3: After the pick,** build it: Use the new guide (asks first if the guide's editor has unsaved changes), Keep mine, the toast, the diff folded under See what changes, removed and added lines told apart by more than colour (a `−` or `+` and a visually hidden word). Delete the other options.
- [ ] **Step 4: Write the e2e tests** (failing first): a changed guide shows the note; See what changes opens the diff; Use the new guide replaces the text in the editor; Keep mine hides the note after a reload; by keyboard alone.
- [ ] **Step 5: Run** `npm test` and `npm run test:e2e`. Expected: PASS. Shoot `after`; measure contrast.

### Task 13: Docs

**Files:**
- Modify: `docs/architecture.md` (§4.1, §4.2, §4.4 (the kept providers), §5, §7 (a new 7.8 for the brief), §8, §9, §10, §12 (§12.3: the lanes and cancelKey), §13, §14, §17), `AGENTS.md` ("Current status": Phase 9), `docs/plan.md`, `docs/handover/do-by-hand.md`, `README.md` (the writing AI, the brief, Get ready, in a few lines)
- Create: `docs/decisions/0012-writing-ai-and-briefs.md`, `docs/checklists/phase-9-windows.md`

- [ ] **Step 1: Write the docs** from the ledger and the code as built (not the plan): the decision record covers the writing AI, the lanes and why, the brief, the budget and its numbers (Task 4's measurement), and the options not taken (a writer per kind, starting a second local program, no brief, refusing long answers). The checklist covers: pick a writing AI once a Claude key is in; time a brief and a plan on Bonsai 2 27B with the real profile (the goal: as long as a rating); a letter written with a brief on Bonsai 2 and on Claude; the starter-guide note after the update (and that an untouched old guide was updated, with its copy in `profile\old-versions`); a Seek ad with a masked email filling in the contact; Windows file names in `old-versions`. The do-by-hand list gets the steps only the user can do.
- [ ] **Step 2: Run** `npm test` (a docs-only change must not break the gitignore or source-text tests). Expected: PASS.
