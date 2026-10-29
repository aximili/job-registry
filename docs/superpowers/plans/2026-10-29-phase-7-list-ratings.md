# Phase 7: Quick Marks on Search Lists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Seek, LinkedIn and Indeed search lists, every job card gets a small mark ("Strong 84", "Good 68 · quick", "Saved · Applied 12 Oct") from a quick AI rating of the card alone. Settings → AI shows each AI task's settings.

**Architecture:** The content script reads the cards (a new `readCards` on each site reader), asks the background what's already known (saved jobs from `jobs`, earlier ratings from `ratings`), then asks for one quick rating at a time. The server's `ratings` module rates a card with a new AI task, `rateCard`, at a new queue priority, `list`, and caches it in a new table. The two rating prompts share one system part, so llama-server's prompt cache serves both.

**Tech Stack:** TypeScript (Node runs `.ts` directly), Fastify, better-sqlite3, zod, Svelte 5, esbuild, Vitest, Playwright, linkedom.

**Spec:** [docs/architecture.md](../../architecture.md): §6.5 (`readCards`), §7.7 (the flow), §8 (`CARD_RATING_CACHE`), §9 (the three new routes), §10 (Settings → AI rows), §11 (card marks, messages, options), §12.1 (`rateCard`, prompt order, settings per task), §12.3 (`list` priority). Read those sections before your task.

## Global Constraints

- **No git writes.** Never `git add`, `commit`, `push`, `stash`, `reset`. The user commits by hand. Leave edits in the working tree.
- **Bash:** never prefix a command with `PATH=…` or `cd … &&`. Never use `curl` or `wget` (use `node -e "fetch(…)"`).
- Plain English and Australian spelling in UI text, docs, comments and prompts. Short sentences.
- TypeScript: erasable syntax only. No `enum`, no constructor parameter properties.
- Architecture rules (CLAUDE.md, architecture.md §4 and §15): other modules import only a module's `index.ts`; SQL only in `repo.ts`; Fastify only in `routes.ts`; every API body is a zod schema in `shared/contracts/`; only `server/app.ts` wires modules; `jobs` never depends on `ai`. `npm run check:deps` must pass. Never weaken a rule.
- Schema change = new file `server/core/db/migrations/006_card_rating_cache.sql`. Never edit old migrations.
- Tests sit next to the code (`*.test.ts`). Fakes live in `tests/fakes/`.
- Prompts are text files in `server/modules/ai/prompts/`.
- No literal invisible characters in source or fixtures (`tests/source-text.test.ts`); write them as `\u` escapes or HTML entities.
- The verdict scale is fixed: strong 80+, good 60–79, stretch 40–59, weak under 40.
- Defaults: `ai.tasks.card` = temperature 0.2, maxTokens 512, thinking false, thinkingEffort "medium". The extension's `rateLists` = true.
- Exact copy (UI): option label "Rate the jobs in search results (a quick rating from each card)"; mark tooltip suffix "Quick rating from the card. Open the job for a full rating."; while rating, "Rating…".
- Full check before you finish a task: `npm test` (typecheck, svelte-check, check:deps, Vitest). Tasks 6 and 7 also run `npm run test:e2e` in the foreground with a 10-minute timeout.

## Review Focus

1. **A site redraws its list** (LinkedIn's virtual list as you scroll; Seek after you click "Save" on a card). The mark must come back, once. Never two marks on one card. Test in Task 6.
2. **A new search while a card is with the AI.** The old loop stops. A late reply is drawn only on a card for the same job, never on whatever card is now in that spot. Test in Task 6.
3. **The app or the AI stops answering.** Don't hammer it: an `offline` reply, or any error other than `cancelled`, stops the loop for that list. The cards that already have marks keep them. Coming back to the tab, or a new list, starts it again. Test in Task 6.
4. **Several search tabs open.** Only the tab in front rates. A hidden tab pauses and carries on when shown. Test in Task 6.
5. **No master profile.** No card goes to the AI at all, and no card gets a mark or an error. Test in Tasks 2 and 6.

---

### Task 1: The `rateCard` AI task, the `list` priority and the shared rating prompt

**Files:**
- Modify: `shared/contracts/rating.ts` (add `JobCard`, `CardRating`, `CardMark`, `RateCardRequest`, `RateCardResponse`, `CardsLookupRequest`, `CardsLookupResponse`)
- Modify: `shared/contracts/ai.ts` (add `card` to `tasks`)
- Modify: `server/modules/ai/queue.ts`, `server/modules/ai/service.ts`, `server/modules/ai/index.ts`
- Create: `server/modules/ai/tasks/rate-card.ts`, `server/modules/ai/prompts/rate-card.md`
- Modify: `server/modules/ai/prompts/rate-job.md` (move its rules into the user part)
- Modify: `tests/fakes/smart-fake-ai.ts` (answer `card_rating`), `config/settings.example.json` if `tests/settings-example.test.ts` needs `card`
- Test: `shared/contracts/contracts.test.ts`, `server/modules/ai/queue.test.ts`, `server/modules/ai/prompts.test.ts`, `server/modules/ai/ai.test.ts`

**Interfaces:**
- Produces (contracts, all zod plus inferred types):
  ```ts
  JobCard = z.object({
    canonicalUrl: z.string().min(1).max(2000),
    sourceSite: SourceSite,
    externalId: z.string().max(200).nullable(),
    title: z.string().min(1).max(300),
    company: z.string().max(300).nullable(),
    location: z.string().max(300).nullable(),
    text: z.string().max(4000),            // everything else the card shows, plain text
  })
  CardRating = z.object({ verdict: Verdict, score: z.number().int().min(0).max(100), reason: z.string() })
  CardMark = z.object({ kind: z.enum(['full', 'quick']), verdict: Verdict, score: z.number().int().min(0).max(100), reason: z.string().nullable() })
  RateCardRequest = z.object({ card: JobCard, key: z.string().min(1).max(100).optional() })
  RateCardResponse = z.object({ rating: CardRating.nullable(), cached: z.boolean(), reason: z.string().nullable() })
  CardsLookupRequest = z.object({ cards: z.array(JobCard).min(1).max(100) })
  CardsLookupResponse = z.object({ results: z.array(CardMark.nullable()), reason: z.string().nullable() })
  ```
- Produces (ai module, exported from `server/modules/ai/index.ts`):
  `type Priority = 'interactive' | 'list' | 'parse' | 'background'`;
  `type CardInput = { profile: string; preferences: string | null; card: string }`;
  `AiService.rateCard(input: CardInput, opts?: { signal?: AbortSignal; key?: string; priority?: Priority }): Promise<CardRating>`, default priority `'list'`, JSON schema name `'card_rating'`, settings `config.tasks.card`.
- Produces (fake): `FAKE_CARD_RATING: CardRating = { verdict: 'good', score: 68, reason: 'Your TypeScript work fits the role.' }`, exported from `tests/fakes/smart-fake-ai.ts` and returned for schema `card_rating`.

- [ ] **Step 1: Write the failing tests**
  - `contracts.test.ts`: `JobCard` accepts a Seek card with `company: null`, rejects an empty title and `text` over 4000 characters; `AiSettings.parse({})` gives `tasks.card` = `{ model: null, temperature: 0.2, maxTokens: 512, thinking: false, thinkingEffort: 'medium', extra: {} }`.
  - `queue.test.ts`: "list runs after interactive and before parse and background". Queue one running task, then a background, a parse, a list and an interactive task. The start order after the running one is interactive, list, parse, background.
  - `prompts.test.ts`: "the two rating prompts share their system part word for word": `loadPrompt(PROMPTS_DIR, 'rate-job').system === loadPrompt(PROMPTS_DIR, 'rate-card').system`, and that system part contains `{{profile}}` and `{{preferences}}` but not `{{ad}}` or `{{card}}`.
  - `ai.test.ts`: `rateCard` sends schema name `card_rating`, uses `tasks.card`'s temperature and maxTokens (set them to 0.4 and 300 in the test config), puts the card text in the last user message, and returns the parsed `CardRating`. A queued `rateCard` with no priority starts after an `interactive` `rateJob` that was queued later.

- [ ] **Step 2: Run them and see them fail**
  Run: `npx vitest run shared/contracts server/modules/ai`
  Expected: FAIL (missing exports, no `rate-card.md`).

- [ ] **Step 3: Implement**
  - `rate-job.md` system part becomes the shared part: a short "who I am and what you do" (rate job ads against my profile; reply with one JSON object that fits the schema and nothing else; base every reason on my profile and the ad or card; never invent experience; Australian spelling), then `My master profile:` `{{profile}}`, `My preferences:` `{{preferences}}`. Its user part starts "Rate this job ad against my profile.", then the existing rules (verdict, score, why, whyNot, dealBreakers, salaryNote), then `The job ad:` `{{ad}}`. Keep the existing rule wording.
  - `rate-card.md`: the identical system part. User part: "Give a quick rating for this job from its card in a search list. The card shows only part of the ad." Rules: the same verdict and score scale; `reason`: one sentence under 20 words, the main reason for the verdict; if the card says too little to judge, rate how well the title fits and say so; a card that clearly hits one of my deal-breakers is "weak". Then `The job card:` `{{card}}`.
  - `tasks/rate-card.ts`: like `tasks/rate-job.ts`, with `runJsonTask` and schema `CardRating`. No ad trimming needed (the card is short).
  - `queue.ts`: `RANK = { interactive: 0, list: 1, parse: 2, background: 3 }`. Update the header comment.
  - `service.ts`: `rateCard` uses `run(o.priority ?? 'list', o.key, o.signal, …)`. `list` is not `background`, so it may start the AI (no change to `ensureRunning`).

- [ ] **Step 4: Run the tests and see them pass**
  Run: `npx vitest run shared/contracts server/modules/ai tests/settings-example.test.ts`, then `npm test`.
  Expected: PASS. Existing `rateJob` tests still pass with the moved rules.

---

### Task 2: The ratings module rates and looks up cards

**Files:**
- Create: `server/core/db/migrations/006_card_rating_cache.sql`
- Modify: `server/modules/ratings/repo.ts`, `service.ts`, `routes.ts`, `index.ts`
- Modify: `shared/api-client.ts` (add `rateCard`, `lookupCards`)
- Test: `server/modules/ratings/ratings.test.ts`, and the api-client's test file if it has one per method

**Interfaces:**
- Consumes: Task 1's contracts and `AiService.rateCard`.
- Produces (ratings service, exported types from `index.ts`):
  ```ts
  cardText(card: JobCard): string        // title, company, location, text: the non-empty ones, one per line
  cardKey(card: JobCard): string         // `${card.canonicalUrl}#${sha256(cardText(card)).slice(0, 16)}`
  RatingsService.rateCard(card: JobCard, opts?: { signal?: AbortSignal; key?: string }): Promise<RateCardResponse>
  RatingsService.lookupCards(cards: JobCard[]): CardsLookupResponse
  ```
- Produces (HTTP): `POST /api/v1/ratings/card` (body `RateCardRequest`, reply `RateCardResponse`; closing the request cancels, like `POST /ratings`; priority `'list'`). `POST /api/v1/ratings/cards/lookup` (body `CardsLookupRequest`, reply `CardsLookupResponse`).
- Produces (api-client): `rateCard(req: z.input<typeof RateCardRequest>, o?: { signal?: AbortSignal }): Promise<RateCardResponse>`, `lookupCards(req: CardsLookupRequest, o?: { signal?: AbortSignal }): Promise<CardsLookupResponse>`.

- [ ] **Step 1: Write the failing tests** (in `ratings.test.ts`, with the fake AI provider)
  - "a card is rated once per profile": the first `rateCard` calls the AI and returns `{ cached: false }`; the second returns `{ cached: true }` and the AI was called once. Changing the master profile file rates it again.
  - "a card with changed text is rated again" (same link, different `text`).
  - "no master profile: no AI call": `rateCard` gives `{ rating: null, cached: false, reason: NO_PROFILE }`; `lookupCards` gives every result `null` with `reason: NO_PROFILE`.
  - "lookup prefers a full rating": save a full rating for `https://www.seek.com.au/job/1` with `rate()`, and a quick one for the same card. `lookupCards` gives `{ kind: 'full', verdict, score, reason: rating.why[0] ?? null }`. For a card with only a quick rating it gives `{ kind: 'quick', …, reason }`. For an unknown card, `null`. Results are in the same order as the cards.
  - "lookup ignores ratings made with an older profile".
  - "a full rating for another link that starts the same is not used": a full rating for `…/job/12` must not match a card for `…/job/1`.
  - Routes: `POST /api/v1/ratings/card` returns the fake's rating; `POST /api/v1/ratings/cards/lookup` with 101 cards is a 400.

- [ ] **Step 2: Run them and see them fail**
  Run: `npx vitest run server/modules/ratings`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  - Migration `006_card_rating_cache.sql`: `card_rating_cache (card_key TEXT NOT NULL, profile_hash TEXT NOT NULL, rating_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (card_key, profile_hash))`. Copy the style of `002_rating_cache.sql`.
  - Repo: `getCard(key, hash): CardRating | null` (a row that fails `CardRating.safeParse` counts as missing), `putCard(key, hash, rating, at)`, `latestFull(canonicalUrl, hash): Rating | null`. `latestFull` matches `ad_key` that starts with exactly `${canonicalUrl}#`. Use `substr(ad_key, 1, length(?)) = ?`, not `LIKE`, because links can hold `%` and `_`. Newest `created_at` first.
  - Service: `rateCard` follows `rate`'s shape (profile check, cache unless `force`, `ai.rateCard({ profile, preferences, card: cardText(card) }, { signal, key })`, store). `lookupCards` reads the profile hash once.

- [ ] **Step 4: Run the tests and see them pass**
  Run: `npx vitest run server/modules/ratings`, then `npm test`.
  Expected: PASS, check:deps clean.

---

### Task 3: `jobs.checkMany` and `POST /jobs/check-many`

**Files:**
- Modify: `shared/contracts/jobs.ts`, `server/modules/jobs/service.ts`, `routes.ts`, `index.ts` (if it re-exports types), `shared/api-client.ts`
- Test: `server/modules/jobs/service.test.ts`, `server/modules/jobs/routes.test.ts`

**Interfaces:**
- Produces (contracts):
  ```ts
  CheckManyRequest = z.object({ items: z.array(JobCheckRequest.pick({ canonicalUrl: true, sourceSite: true, externalId: true })).min(1).max(100) })
  CheckManyResponse = z.object({ results: z.array(ExactMatch.nullable()) })
  ```
- Produces: `JobsService.checkMany(items: CheckManyRequest['items']): (ExactMatch | null)[]`; `POST /api/v1/jobs/check-many`; api-client `checkMany(req: CheckManyRequest, o?: { signal?: AbortSignal }): Promise<CheckManyResponse>`.

- [ ] **Step 1: Write the failing tests**
  - Service: save two jobs. `checkMany` for [job A's link, an unknown link, job B's site and id with a different link] gives [A's `ExactMatch`, `null`, B's `ExactMatch`], in order. The match is the same one `check()` gives as `exact` for each item, including an archived job if `check()` includes one.
  - Route: 101 items is a 400; an empty list is a 400.

- [ ] **Step 2: Run them and see them fail**
  Run: `npx vitest run server/modules/jobs`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  Factor `check()`'s exact-match lookup into one private function and use it in both. No "likely" matching in `checkMany`.

- [ ] **Step 4: Run the tests and see them pass**
  Run: `npx vitest run server/modules/jobs`, then `npm test`.
  Expected: PASS.

---

### Task 4: Site readers find the job cards

**Files:**
- Modify: `extension/src/sites/helpers.ts` (`FoundCard`, `readCards` on `SiteExtractor`, a shared `foundCard()` helper)
- Modify: `extension/src/sites/seek.ts`, `linkedin.ts`, `indeed.ts`, `generic.ts` (returns `[]`)
- Modify fixtures: `tests/fixtures/sites/linkedin-search.html` (signed-in, hand-made), `tests/fixtures/sites/indeed-search.html` (hand-made). Already added: `seek-search-real.html` and `linkedin-guest-search.html` (real, 10 cards each), `seek-search.html` (hand-made). Update `tests/fixtures/sites/README.md`.
- Modify: `scripts/ext-check.ts` (also prints the cards it finds)
- Test: `extension/src/sites/sites.test.ts`, `tests/extension-build.test.ts` (the ext-check output test, if it checks the output)

**Interfaces:**
- Produces:
  ```ts
  type FoundCard = { element: Element; anchor: Element; card: JobCard };
  interface SiteExtractor { …; readCards(doc: Document, url: URL): FoundCard[] }
  ```
  `element` is the card's root. `anchor` is the element the mark goes right after: the title's heading (`h1`–`h4`) if the title link sits in one, else the title link. `card.canonicalUrl`, `sourceSite` and `externalId` come from `canonicalJobUrl()` on the card's job link. A card with no `externalId` is skipped. Cards come in page order, each job once (the first one wins). `text` is the card's other visible text, whitespace collapsed, each part on its own line, at most 4000 characters, without the title, company and location repeated, and without button text such as "Save" or "Easy Apply".

- [ ] **Step 1: Write the failing tests** (in `sites.test.ts`)
  - Seek, real (`seek-search-real.html` at `https://au.seek.com/full-stack-developer-jobs/in-All-Melbourne-VIC`): 10 cards, each with a 7–9 digit `externalId`, `canonicalUrl` `https://www.seek.com.au/job/<id>`, a title and a company. The first card's values match the fixture: read them from the page and write them into the test as literals. At least one card's `text` holds a salary (`$`) and one holds its teaser. No card's `text` contains its own title. Each `anchor` is inside its `element`.
  - Seek, hand-made (`seek-search.html` at `https://www.seek.com.au/software-engineer-jobs`): the cards it has, with the same rules.
  - LinkedIn, signed in (`linkedin-search.html`, extended to at least 3 cards: one normal, one "Promoted" with salary, and one occluded `li[data-occludable-job-id]` with no content yet). The occluded one is skipped. `canonicalUrl` is `https://www.linkedin.com/jobs/view/<id>/`. The title isn't doubled (LinkedIn repeats it in a visually hidden span).
  - LinkedIn, signed out (`linkedin-guest-search.html` at `https://www.linkedin.com/jobs/search?keywords=Full%20Stack%20Developer`): 10 cards from `.base-card` / `data-entity-urn="urn:li:jobPosting:<id>"`, with title, company and location.
  - Indeed (`indeed-search.html`, extended to at least 3 cards: one with salary and snippet bullets, and one with no `data-jk`). The one with no `data-jk` is skipped. `canonicalUrl` is `https://au.indeed.com/viewjob?jk=<jk>`.
  - The existing single-job tests still pass on the edited fixtures.
  - Generic: `readCards` is `[]`.

- [ ] **Step 2: Run them and see them fail**
  Run: `npx vitest run extension/src/sites`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  Starting selectors. Confirm each one against the fixture and keep the ones that work:
  - Seek: card `article[data-automation="normalJob"], article[data-card-type="JobCard"]`, id `data-job-id`, title `a[data-automation="jobTitle"]`, company `[data-automation="jobCompany"]`, location `[data-automation="jobLocation"]` (there can be several; join with ", "), salary `[data-automation="jobSalary"]`, teaser `[data-automation="jobShortDescription"]`, bullets `ul li`, date `[data-automation="jobListingDate"]`. Job link `/job/<id>` on the page's own origin.
  - LinkedIn signed in: `li[data-occludable-job-id]` (or `.job-card-container[data-job-id]`), title `.job-card-list__title--link` / `a.job-card-container__link` (use the visible `strong` or `aria-label`, not the hidden duplicate), company `.artdeco-entity-lockup__subtitle`, location `.artdeco-entity-lockup__caption` / `.job-card-container__metadata-wrapper li`, extra `.artdeco-entity-lockup__metadata`, footer insights.
  - LinkedIn signed out: `.base-card`, link `a.base-card__full-link`, title `.base-search-card__title`, company `.base-search-card__subtitle`, location `.job-search-card__location`, salary `.job-search-card__salary-info`, date `time`.
  - Indeed: card `.job_seen_beacon` (or `li` holding `a[data-jk]`), id `data-jk` on `a.jcs-JobTitle`, title `h2.jobTitle span[title]` or `h2.jobTitle`, company `[data-testid="company-name"]`, location `[data-testid="text-location"]`, salary and attributes `[data-testid="attribute_snippet_testid"]` / `.salary-snippet-container`, snippet `[data-testid="jobsnippet_footer"] li` / `.job-snippet li`. Job link `${origin}/viewjob?jk=<jk>`.
  - Hand-made fixture edits follow each site's known structure (October 2026). Add comments to the fixture saying it's hand-made.
  - To trim a real page you save later: `node /private/tmp/claude-502/-Users-hardi-sempuno-ACN-Test-projects-Claude-job-registry/7247b26b-0429-4fb7-9efa-e4d284128258/scratchpad/trim.mjs in.html out.html "comment" [--keep-classes]`. You don't need it for this task.
  - `ext-check`: after the job, print `Cards: N`, then one line per card: `<externalId>  <title> · <company> · <location>`.

- [ ] **Step 4: Run the tests and see them pass**
  Run: `npx vitest run extension/src/sites tests/extension-build.test.ts`, then `npm test`.
  Expected: PASS.

---

### Task 5: The background answers `cards` and `rateCard`; the `rateLists` option

**Files:**
- Modify: `extension/src/messages.ts`, `extension/src/handlers.ts`, `extension/src/settings.ts`, `extension/src/options/Options.svelte`
- Test: `extension/src/handlers.test.ts`, `extension/src/settings.test.ts`, `tests/fakes/fake-chrome.ts` if it needs `rateLists`

**Interfaces:**
- Consumes: api-client `checkMany` (Task 3), `lookupCards` and `rateCard` (Task 2).
- Produces:
  ```ts
  // messages.ts
  | { type: 'cards'; cards: JobCard[] }
  | { type: 'rateCard'; card: JobCard }
  type CardsInfo = { saved: (ExactMatch | null)[]; marks: (CardMark | null)[]; reason: string | null };
  ReplyData.cards: CardsInfo; ReplyData.rateCard: RateCardResponse
  // settings.ts
  type ExtensionSettings = { serverUrl: string; autoRate: boolean; rateLists: boolean }  // rateLists default true
  ```

- [ ] **Step 1: Write the failing tests**
  - `handlers.test.ts`: `cards` calls `checkMany` and `lookupCards` with the same cards in the same order and merges them into `CardsInfo`; it uses the quick timeout. `cards` with 0 cards answers `{ saved: [], marks: [], reason: null }` without calling the server. `rateCard` sends `key: 'cards-tab-7'` for tab 7. A second `rateCard` from tab 7 aborts the first (its reply is `{ ok: false, error: 'cancelled' }`). A `rateCard` and a `rate` from the same tab don't cancel each other. The offline and no-access replies work as they do for `rate`.
  - `settings.test.ts`: `rateLists` defaults to true, and a stored `false` is kept.

- [ ] **Step 2: Run them and see them fail**
  Run: `npx vitest run extension/src/handlers.test.ts extension/src/settings.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  A second per-tab `AbortController` map for card ratings, apart from `ratings`. `cards` sends at most 100 cards per request (the content script never sends more, but cut the list to be safe). Options page: a second checkbox under "Rate jobs automatically on job pages", with the exact label from Global Constraints, saved like `autoRate`.

- [ ] **Step 4: Run the tests and see them pass**
  Run: `npx vitest run extension/src`, then `npm test`.
  Expected: PASS.

---

### Task 6: Card marks on the page

**Files:**
- Create: `extension/src/cards.ts` (the card watcher and rating loop), `extension/src/marks.ts` (draws one mark), `extension/src/cards.test.ts`, `extension/src/marks.test.ts`
- Modify: `extension/src/content.ts` (start the card watcher; after a full rating arrives for the open job, update that job's card)
- Modify: `extension/src/panel/text.ts` only if you reuse `savedText` or the verdict words from there (share, don't copy)

**Interfaces:**
- Consumes: `SiteExtractor.readCards` (Task 4); messages `cards` and `rateCard`, `loadSettings().rateLists` (Task 5).
- Produces:
  ```ts
  // cards.ts
  export function watchCards(opts: {
    doc: Document;
    location: () => URL;
    extractor: () => SiteExtractor;
    ask: typeof ask;                      // injected, so tests pass a fake
    enabled: () => Promise<boolean>;      // loadSettings().rateLists
    visible: () => boolean;               // document.visibilityState === 'visible'
    intervalMs?: number;                  // default 1000
  }): { stop(): void; showFull(canonicalUrl: string, rating: Rating): void };
  // marks.ts
  export type MarkState =
    | { kind: 'rating' }
    | { kind: 'mark'; mark: CardMark }
    | { kind: 'saved'; saved: ExactMatch; mark: CardMark | null };
  export function drawMark(found: FoundCard, state: MarkState, opts?: { open?: boolean }): void;  // adds or updates; never two
  export function markText(state: MarkState): string;  // "Strong 84", "Good 68 · quick", "Saved · Applied 12 Oct", "Rating…"
  ```

- [ ] **Step 1: Write the failing tests** (linkedom pages and fake timers, like `watcher.test.ts`)
  - `marks.test.ts`: `markText` gives "Strong 84" for a full strong 84, "Good 68 · quick" for a quick one, the panel's saved wording for a saved job ("Saved · Applied 12 Oct" when applied), and "Rating…". The tooltip (`title` on the host) is the reason, plus "Quick rating from the card. Open the job for a full rating." for a quick one. Drawing twice on one card leaves one host (`[data-job-registry-mark]`), updated. The host comes right after `anchor`.
  - `cards.test.ts`:
    1. "known cards are drawn at once, then the rest are rated one at a time in page order". Three cards: one saved, one with a quick mark, one unknown. One `cards` request, then marks on the first two, then one `rateCard` for the third. Never two `rateCard` requests in flight.
    2. "cards on screen go first": with a fake `getBoundingClientRect`, an unknown card in view is rated before an earlier one out of view.
    3. "a hidden tab pauses and carries on when shown".
    4. "rateLists off: no requests at all".
    5. "no master profile (`reason` set): no `rateCard`, no marks".
    6. "an offline or error reply stops the loop. Marks already drawn stay. A new list starts it again." A `cancelled` reply doesn't stop it.
    7. "a new search: the old loop stops, and a late reply is drawn only on a card for the same job". Swap the list while a `rateCard` is pending, then resolve it.
    8. "a redrawn card gets its mark back, once". Replace a card's element with a fresh copy; after the next tick it has exactly one mark, with no new request.
    9. "cards that load later (scrolling) are looked up in one more `cards` request".
    10. "`showFull` turns that card's quick mark into the full one".

- [ ] **Step 2: Run them and see them fail**
  Run: `npx vitest run extension/src/cards.test.ts extension/src/marks.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  - Remember state by `canonicalUrl`, not by element. Each tick: `readCards`; cards not seen before go into one `cards` request; then make sure each card's element has its mark (`drawMark`). The list is "new" when the page's address (path and search, without `jobId` / `currentJobId` / `vjk`) changes. Then clear the loop, but keep what's known per link.
  - The loop: while enabled, visible, and not stopped, pick the first unknown card in view (else the first unknown in page order), draw "Rating…", send `rateCard`, draw the answer. Stop the loop on `offline`, on an error other than `cancelled`, or when `rating` is null.
  - Marks: a `span` host with `data-job-registry-mark`, a closed shadow root (`open` in the test build: use the panel's existing switch for this), inline-block, small, the verdict colours from `Panel.svelte`, `position: relative; z-index: 1` so it sits above Seek's whole-card link and its tooltip shows.
  - `content.ts`: start `watchCards` once per page, with the same `siteLocation` and `pickExtractor`. In `rate()`, when a full rating arrives, call `showFull(capture.canonicalUrl, rating)`.

- [ ] **Step 4: Run the tests and see them pass**
  Run: `npx vitest run extension/src`, then `npm test`, then `npm run ext:build`.
  Expected: PASS; the build succeeds.

---

### Task 7: Browser tests for the marks

**Files:**
- Create: `tests/e2e/fixtures/seek-list.html` (a Seek search list, 3 cards; copy the card markup from `tests/fixtures/sites/seek-search-real.html`, with ids 81234567, 81234570 and 81234571 so one matches `seek-job.html`)
- Modify: `tests/e2e/serve.ts` (serve `/seek/list` → `seek-list.html`), `tests/e2e-extension/extension.spec.ts`

**Interfaces:**
- Consumes: everything above; `FAKE_CARD_RATING` (Task 1). The e2e server's AI is the smart fake.

- [ ] **Step 1: Write the failing tests** (`extension.spec.ts`)
  - "each card on a search list gets a quick mark": open `${SITES}/seek/list`; every card shows one mark "Good 68 · quick" (read through the open test-build shadow root).
  - "a card for a job you saved says so": save job 81234567 first (open its page, press Save), then open the list. That card says "Saved", and the other two show the quick mark.
  - "with 'Rate the jobs in search results' off, no marks": untick it on the options page, open the list, wait 3 seconds, no marks.

- [ ] **Step 2: Run them and see them fail**
  Run: `npm run test:e2e -- --project=extension` (foreground, 10-minute timeout)
  Expected: the new tests FAIL before the route exists.

- [ ] **Step 3: Implement** the fixture and the route.

- [ ] **Step 4: Run all browser tests and see them pass**
  Run: `npm run test:e2e` (foreground, 10-minute timeout).
  Expected: every test passes (257 before this phase, plus the new ones).

---

### Task 8: Settings → AI shows each task's settings

**Files:**
- Modify: `web/src/components/AiSettingsSection.svelte` (or a new `web/src/components/AiTaskSettings.svelte` it includes)
- Test: the dashboard's existing settings e2e spec in `tests/e2e/` (find the one that covers Settings → AI), plus a unit test for any pure mapping helper in `web/src/lib/`

**Interfaces:**
- Consumes: `AiSettings.tasks` (now with `card`), the existing `PATCH /settings` flow the AI section already uses.
- Produces: a mapping helper in `web/src/lib/ai-tasks.ts`:
  ```ts
  type Thinking = 'off' | 'low' | 'medium' | 'high';
  thinkingOf(t: TaskSettings): Thinking            // thinking false → 'off'; else low/medium/'xhigh'→'high'
  withThinking(t: TaskSettings, v: Thinking): TaskSettings  // 'off' → thinking false, effort kept
  TASK_ROWS: { key: 'parse' | 'rate' | 'card' | 'write' | 'email'; label: string }[]
  // labels: "Reading job ads", "Rating a job", "Quick marks on search lists", "Writing resumes and cover letters", "Reading emails"
  ```

- [ ] **Step 1: Write the failing tests**
  - Unit: `thinkingOf` and `withThinking` round-trip all four values; `withThinking(t, 'off')` keeps `thinkingEffort` and `extra`.
  - e2e: on `/settings#ai`, under "How the AI works on each task", the "Quick marks on search lists" row shows Thinking "Off" and Longest answer 512. Change Rating a job's Thinking to "Low" and Longest answer to 1500, save, reload: both stick. The settings file's `ai.tasks.rate.extra` is unchanged.
  - Empty Model means "the same as above". A non-number or under-16 Longest answer shows a plain message and doesn't save.

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement**
  One labelled row per task, as a table or a list of fieldsets, whichever reads better with the existing section. The fields: Thinking (select: Off, Low, Medium, High), Longest answer (number, tokens), Temperature (number, 0–2, step 0.1), Model (text; placeholder "Same as above"). It saves with the section's existing save button. Every field has a visible label and works by keyboard.

- [ ] **Step 4: Run the tests and see them pass**
  Run: `npm test`, then `npm run test:e2e` (foreground, 10-minute timeout).
  Expected: PASS.

---

### Task 9: Docs and close-out

**Files:**
- Modify: `CLAUDE.md` (Current status: Phase 7 entry), `docs/plan.md` (Phase 7: what it adds and what "done" means), `docs/architecture.md` §17 (risk: list markup changes more often than job pages; `ext-check` prints cards)
- Create: `docs/checklists/phase-7-windows.md` (real signed-in Seek, LinkedIn and Indeed lists: marks appear, come back after scrolling, no doubled marks, the time per card with Bonsai 2, the tab-in-front rule, the option off)
- Modify: `docs/handover/do-by-hand.md` (the extension step also opens one search list per site and looks for marks), `docs/handover/runbook.md` only if a scripted check covers card ratings (e.g. `ai-smoke` could time one `rateCard`; add it only if it fits that script's pattern)
- Modify: `tests/fixtures/sites/README.md` (the new real fixtures)

- [ ] **Step 1:** Write the docs. Keep the handover docs tool-neutral.
- [ ] **Step 2:** Run `npm test` and `npm run test:e2e` (foreground, 10-minute timeout). Record the counts in the ledger.
