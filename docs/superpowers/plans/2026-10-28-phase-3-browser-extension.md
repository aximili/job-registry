# Phase 3 — Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Firefox (and Chrome) extension that, on Seek, LinkedIn and Indeed job pages (including split-pane search views), shows a small panel. The panel says "Saved · Applied 12 Oct" for a job you have. For a new one, it offers a one-click **Save** with a status, and shows the match rating. A toolbar popup (and `Alt+Shift+J`) saves any other page. The server is never called from a content script.

**Architecture:** Architecture §11 and §6.5.
- **Content scripts** pick a `SiteExtractor` (Seek, LinkedIn, Indeed, then generic), watch the page for job changes, build a `Capture`, and render a Svelte panel in a shadow root.
- **The background script** owns all server calls through `shared/api-client.ts`: check, save, rate (one "latest wins" key per tab, with stale requests aborted) and the badge.
- **The popup** injects the generic extractor into the active tab with `activeTab` and `scripting`.
- **The build:** `extension/build.mjs` (esbuild + esbuild-svelte) merges a base manifest with a Firefox or Chrome one into `extension/dist/{firefox,chrome}`.

**Tech stack:** as before, plus `esbuild` 0.28, `esbuild-svelte` 0.9, `web-ext` 10, `@types/chrome` (dev only). The promise-based `chrome.*` API, which Firefox also provides.

**Spec:** docs/plan.md (Phase 3, "Save a job (extension)", "Match rating"), docs/architecture.md §3, §6.5, §7.1, §7.3, §11, §13 and §16 ("Add a job site"). CLAUDE.md "Notes for Phase 3" adds the group C minors and the checkpoint's cancelled-rating minor.

## Global Constraints

- Everything in the earlier plans' Global Constraints still holds: erasable TypeScript, `.ts` import extensions, zod contracts, plain English and Australian spelling, no git writes, and `npm run check:deps` passing. The check now also cruises `extension/src`.
- **Content scripts never call the server.** Only `extension/src/background.ts` imports `shared/api-client.ts`. A new dependency rule enforces this.
- **`extension/` never imports from `server/`** (the existing `clients-not-server` rule).
- **Permissions:** `storage`, `activeTab`, `scripting`. Host permissions: `http://127.0.0.1/*` (any port, because the port is a setting) and the job sites. Content scripts match:
  - `https://www.seek.com.au/*`, `https://www.seek.co.nz/*`
  - `https://www.linkedin.com/jobs/*`
  - `https://*.indeed.com/*`
- **Firefox:** `background.scripts`, `browser_specific_settings.gecko.id` = `job-registry@local`, `strict_min_version` `128.0`. **Chrome:** `background.service_worker`.
- **Saves from the extension** send `source: 'extension'`.
- **Fixtures:**
  - The site fixtures in `tests/fixtures/sites/` are hand-made from each site's known structure, except `linkedin-guest-job.html`, a trimmed real LinkedIn guest page.
  - Seek and Indeed refuse server downloads (HTTP 403, checked 28 Oct 2026), so the user's own saved pages are the real check, on the Windows checklist and through `npm run ext:check`.
- **Signing:** `npm run ext:sign` uses `web-ext sign --channel=unlisted`, with `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` from the environment. The keys are never stored in the repo.

## Review Focus

1. **Clicking quickly through search results** (split-pane views on all three sites): only the last job's rating shows. Earlier requests are aborted in the browser and cancelled on the server. The panel never shows one job's rating under another's title. → Tasks 5, 6
2. **The app isn't running** when a job page opens. The panel says "Job Registry isn't running. Start it, then press Try again." and offers **Try again**. Nothing throws, and the page itself is unaffected. → Tasks 5, 7
3. **A page where the extractor finds nothing** (a layout change, a page still loading, a sign-in wall). The page watcher waits up to 5 seconds for the job's text. If it still has nothing, the panel offers to save the selected text or the page's readable text. It never saves an empty ad without saying so. → Tasks 3, 4, 7
4. **A site's own styles or scripts** (dark mode, a CSS reset, `z-index` wars). The panel lives in a shadow root with its own styles, sits above the page, can be minimised, and is keyboard reachable. → Task 7
5. **Saving the same job twice** (from the panel and then the popup, or from Seek and then LinkedIn). The first is "created", the second "exists" (exact URL or id) or "Same job?" (likely). The status chosen moves the job forward only, as on the dashboard. → Tasks 5, 6

---

## File map

```
extension/   manifest.base.json, manifest.firefox.json, manifest.chrome.json, build.mjs, tsconfig.json, README.md
extension/src/   background.ts, content.ts, messages.ts, settings.ts, watcher.ts, capture.ts, jsonld.ts, text.ts
extension/src/sites/   index.ts, seek.ts, linkedin.ts, indeed.ts, generic.ts, helpers.ts
extension/src/panel/   Panel.svelte, mount.ts
extension/src/popup/   popup.html, Popup.svelte, main.ts
extension/src/options/ options.html, Options.svelte, main.ts
extension/icons/   (generated PNGs: 16, 32, 48, 128)
shared/jobposting.ts           (JobPosting → Partial<ParsedJob>, moved from server/modules/capture/jsonld.ts)
server/core/http/security.ts   (CORS for extension origins, nosniff)
server/core/http/errors.ts     (a cancelled request is quiet)
shared/canonical-url.ts        (LinkedIn /comm/jobs/view links)
shared/contracts/common.ts     (IsoDateTime normalised to UTC)
web/src/lib/live.svelte.ts     (close the event stream while a tab is hidden)
scripts/ext-check.ts           (npm run ext:check -- page.html URL)
tests/fixtures/sites/          seek-job.html, seek-search.html, linkedin-job.html, linkedin-search.html,
                               linkedin-guest-job.html, indeed-job.html, indeed-search.html,
                               generic-jsonld.html, generic-article.html, README.md
tests/fakes/fake-chrome.ts
tests/e2e-extension/           extension.spec.ts, serve-sites.ts, playwright config entry
docs/checklists/phase-3-windows.md
```

---

### Task 1: Server — group C minors, CORS for extensions, quiet cancels

**Files:** `shared/canonical-url.ts`, `shared/contracts/common.ts`, `server/core/http/security.ts`, `server/core/http/errors.ts`, `tsconfig.json`, `web/src/lib/live.svelte.ts`, with their tests.

- **M11:** `https://www.linkedin.com/comm/jobs/view/4470914440/?trackingId=…` → `https://www.linkedin.com/jobs/view/4470914440/`, id `4470914440`.
- **M9:**
  - `IsoDateTime` accepts an offset and normalises it to UTC: `'2026-10-28T14:15:00+11:00'` → `'2026-10-28T03:15:00.000Z'`.
  - The server `tsconfig.json` drops the DOM library. `web/` has its own tsconfig; `extension/` gets one.
- **nosniff:** every response has `X-Content-Type-Options: nosniff`. No Cross-Origin-Resource-Policy (it could block the extension).
- **CORS:**
  - For an `Origin` of `moz-extension://…` or `chrome-extension://…`, responses carry `Access-Control-Allow-Origin: <origin>` and `Vary: Origin`.
  - `OPTIONS` preflights from those origins get 204, with `Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE` and `Access-Control-Allow-Headers: content-type`.
  - Any other origin gets no CORS headers.
- **M13:** a request whose work was cancelled (an `AbortError`) is logged at debug level, not as an error with a stack. Its reply is a 503 with `ai_unavailable` and "The AI task was cancelled."
- **R-a:** the dashboard closes its live-events stream while the tab is hidden, and reopens it (then reloads the open page's data) when the tab is shown again.

Tests (each RED first):
- canonical-url cases.
- A contracts test for the offset.
- security tests: `nosniff` on a GET; CORS headers for a `moz-extension` origin on GET and on an `OPTIONS` preflight; none for `https://evil.example`.
- An errors test that an aborted handler gives 503 and no error log.
- A Playwright test in `search.spec.ts`: hiding the page with `page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })` closes the EventSource (checked through a counter on `window`, exposed only in test builds).
  - Ruling allowed: if a test-only hook would be needed, cover this with a unit test of a small `liveConnection(visible: () => boolean)` helper instead.

---

### Task 2: Shared JobPosting mapping

**Files:** create `shared/jobposting.ts`. Modify `server/modules/capture/jsonld.ts` to use it. Tests: `shared/jobposting.test.ts`, plus the existing `jsonld.test.ts`, which stays green.

- `mapJobPosting(data: unknown): { structured: Partial<ParsedJob>; descriptionHtml: string | null } | null`. It finds a JobPosting in a parsed JSON-LD value: an object, an array, or `@graph`.
- It uses the same mapping the server has today: title, organisation, location, employment type, salary, the closing-date rules from Phase 2 and `TELECOMMUTE`.
- It's pure (no DOM, no Node), so both the server and the extension use it. The server keeps turning the description HTML into text with its own helper.

Tests: move the mapping cases from `jsonld.test.ts` into `jobposting.test.ts`, and keep one end-to-end HTML case in `jsonld.test.ts`.

---

### Task 3: Site extractors and fixtures

**Files:** `extension/src/sites/{index,helpers,seek,linkedin,indeed,generic}.ts`, `extension/src/jsonld.ts` (reads `script[type="application/ld+json"]` through `mapJobPosting`), `extension/src/text.ts` (DOM element to readable text with line breaks), `tests/fixtures/sites/*`, `extension/src/sites/sites.test.ts` (linkedom).

**Interfaces (Produces):**
- `interface SiteExtractor { id: 'seek' | 'linkedin' | 'indeed' | 'generic'; matches(url: URL): boolean; currentJobId(url: URL, doc: Document): string | null; extract(doc: Document, url: URL, now: Date): Capture | null }`. It's synchronous: the watcher does the waiting.
- `pickExtractor(url: URL): SiteExtractor`
- `firstText(doc, selectors: string[]): string | undefined` (helpers)

How each field is found, in order:
1. The site's selectors.
2. The page's JobPosting data.
3. Nothing.

`jdText` is the description element's text. If that's missing, it's the readable text of the job pane. `canonicalUrl`, `sourceSite` and `externalId` come from `canonicalJobUrl` on a URL built from the current job id, so the split-pane `?jobId=` and `?currentJobId=` forms work. `extract` returns `null` when there's no title and no description yet, which means the page is still loading.

Selectors (the first match wins):
- **Seek:**
  - id: `/job/(\d+)` or `?jobId=`
  - title `[data-automation="job-detail-title"]`
  - company `[data-automation="advertiser-name"]`
  - location `[data-automation="job-detail-location"]`
  - work type `[data-automation="job-detail-work-type"]`
  - salary `[data-automation="job-detail-salary"]`
  - description `[data-automation="jobAdDetails"]`
- **LinkedIn:**
  - id: `/jobs/view/(\d+)` or `?currentJobId=`
  - title `.job-details-jobs-unified-top-card__job-title`, `.jobs-unified-top-card__job-title`, `.top-card-layout__title`
  - company `.job-details-jobs-unified-top-card__company-name`, `.jobs-unified-top-card__company-name`, `.topcard__org-name-link`
  - location `.job-details-jobs-unified-top-card__primary-description-container .tvm__text`, `.job-details-jobs-unified-top-card__bullet`, `.topcard__flavor--bullet`
  - description `#job-details`, `.jobs-description__content`, `.jobs-box__html-content`, `.show-more-less-html__markup`
- **Indeed:**
  - id: `?jk=` or `?vjk=`
  - title `[data-testid="jobsearch-JobInfoHeader-title"]`, `.jobsearch-JobInfoHeader-title`
  - company `[data-testid="inlineHeader-companyName"]`, `[data-company-name="true"]`
  - location `[data-testid="inlineHeader-companyLocation"]`, `[data-testid="job-location"]`
  - salary `#salaryInfoAndJobType`
  - description `#jobDescriptionText`
- **Generic:**
  1. The page's JobPosting data (with `descriptionHtml` turned into text).
  2. Otherwise the selected text, if over 200 characters.
  3. Otherwise Mozilla Readability's text.
  4. Otherwise `null`.

  The id is `null`. `sourceSite` comes from `canonicalJobUrl`.

Tests, one per fixture (title, company, location, a slice of the ad text, `canonicalUrl` and `externalId`):
- Seek: job page; search page with `?jobId=` (the right pane's job, not the list's first card).
- LinkedIn: job page; search page with `?currentJobId=`; the real guest page.
- Indeed: job page with `?jk=`; search page with `?vjk=`.
- Generic: JSON-LD page, and an article page with Readability. Selected text wins over Readability.
- A loading page (no title, no description) gives `null`.

---

### Task 4: The page watcher

**Files:** `extension/src/watcher.ts`, `extension/src/watcher.test.ts`.

- `watchJobs(opts: { doc: Document; location: () => URL; extractor: () => SiteExtractor; onJob: (capture: Capture | null, jobId: string | null) => void; now: () => Date; intervalMs?: number; waitMs?: number }): () => void`
- Every `intervalMs` (500), it checks the URL and the extractor's job id.
- When the id changes, it tries `extract` straight away, then again on DOM changes (a `MutationObserver`) and on each tick, until it gets a Capture or `waitMs` (5,000) passes. Then it calls `onJob` once: with the Capture, or with `null` if nothing was found (the panel's "couldn't read" state).
- A change of id while it's still waiting cancels the wait for the older job.

Tests (fake timers, linkedom):
- An id change triggers one `onJob`.
- Content that appears late is still caught.
- A page that never fills gives `onJob(null)` after 5 s.
- A quick A→B→C change calls `onJob` only for C.

---

### Task 5: Messages and the background script

**Files:** `extension/src/messages.ts`, `extension/src/settings.ts`, `extension/src/background.ts`, `tests/fakes/fake-chrome.ts`, `extension/src/background.test.ts`.

**Interfaces (Produces):**
- `type Request =`
  - `{ type: 'check'; capture: Capture }`
  - `{ type: 'rate'; capture: Capture }`
  - `{ type: 'save'; capture: Capture; status: string; note: string; decision?: SaveDecision }`
  - `{ type: 'captureActiveTab' }`
  - `{ type: 'openJob'; jobId: number }`
  - `{ type: 'health' }`
- Replies: `{ ok: true; data: … } | { ok: false; error: string; offline: boolean }`. `offline` is true when the server can't be reached at all.
- `type ExtensionSettings = { serverUrl: string; autoRate: boolean }`, default `{ serverUrl: 'http://127.0.0.1:4777', autoRate: true }`, kept in `chrome.storage.local`.
- `handleMessage(req: Request, sender: { tabId: number | null }, deps: { api: ApiClient; chrome: ChromeLike; settings: () => Promise<ExtensionSettings> }): Promise<Reply>`. It's exported, so it can be tested without a browser.

Rules:
- **check:** `api.checkJob(...)`. With an exact match, set the tab's badge to `✓`; otherwise clear it.
- **rate:**
  - Uses one `AbortController` per tab. A new `rate` from the same tab aborts the older request.
  - Calls `api.rate({ capture, key: 'tab-' + tabId })`.
  - An aborted request replies `{ ok: false, error: 'cancelled', offline: false }`. The content script ignores that reply.
- **save:**
  - `api.saveJob({ capture, status, decision, source: 'extension' })`.
  - On `created`, `linked` or `exists`, a note is added with `api.addNote` when one was typed.
  - The badge becomes `✓`.
- **captureActiveTab:**
  - `chrome.scripting.executeScript({ target: { tabId }, files: ['generic.js'] })`.
  - The injected script returns a Capture (or null). The background passes that on.
- **openJob:** `chrome.tabs.create({ url: serverUrl + '/jobs/' + id })`.

Tests use `createTestApp` listening on a free port, with a real `createApiClient` pointed at it, plus `FakeChrome`:
- Check sets the badge.
- Save with `applied` creates the job with `source: 'extension'`, and the history shows it.
- Save twice gives "exists" and moves the status forward.
- A second rate from the same tab aborts the first. The fake AI waits 500 ms, and the first reply is "cancelled".
- With the server down, every request replies `offline: true`.
- The note is added.

---

### Task 6: Checkpoint review 1 (Tasks 1–5)

Fresh Opus reviewer. Fix every critical and important finding with a failing test first.

---

### Task 7: Content script and the panel

**Files:** `extension/src/content.ts`, `extension/src/capture.ts` (builds the selected-text and readable-text fallbacks), `extension/src/panel/{Panel.svelte,mount.ts}`.

- `mountPanel(host: Document): { update(state: PanelState): void; destroy(): void }`.
  - It puts `<job-registry-panel>` at the end of `body`, with a shadow root (mode `closed`), its own styles, `position: fixed; right: 16px; bottom: 16px; z-index: 2147483647`.
  - It has a minimise button, which remembers its setting in `chrome.storage.local`.
- `type PanelState =`
  - `loading`
  - `offline` ("Job Registry isn't running. Start it, then press Try again.")
  - `unreadable` ("Couldn't read this job. Select the ad text and press Save selection, or save the whole page.")
  - `saved` ("Saved · {status} {date}" + **Open in Job Registry**)
  - `likely` ("Looks like {title} at {company} (from {sites}, {status}). **Same job** / **Different job**")
  - `new` (**Save**, a status select with Saved and Applied, and an optional note)

  Plus `rating`: `pending` ("Rating…"), a verdict with a score, why/whyNot (at most four each, as on the dashboard), a reason (no profile), or an error.
- The flow: the watcher's `onJob` → `check` → state.
  - If `autoRate` is on, `rate` too. Ratings show for saved jobs as well.
  - Replies for an older job are dropped (a per-job sequence number).
  - Save sends `save`. A `needs_decision` reply moves to `likely`.
- Keyboard: the panel's controls are buttons and a select, in tab order. Esc minimises it.
- Copy uses Australian dates ("12 Oct") from `web/src/lib/format.ts`'s logic. That logic moves to `shared/dates.ts` (`shortDate`), so both clients use it.

Tests: the panel's state-to-text mapping as a pure function (`panelText(state)`) in a unit test. The full panel is covered by the e2e in Task 10.

---

### Task 8: Popup, options, shortcut

**Files:** `extension/src/popup/*`, `extension/src/options/*`, `extension/src/sites/generic-entry.ts` (the `generic.js` that `executeScript` injects; it returns a Capture).

- **Popup:**
  - It shows the server state (`health`): "Connected to Job Registry" or the offline sentence.
  - It has **Save this page**, which runs `captureActiveTab` and shows the title, company and the first 300 characters of the ad, with the status select, a note and **Save**. The result shows the same way as in the panel.
  - It has **Open Job Registry**.
- **Options:** **Server address** (validated as an http URL), and **Rate jobs automatically on job pages** (checkbox). Changes are saved at once ("Saved.").
- **Shortcut:** `commands._execute_action` with `Alt+Shift+J`.

Tests: options validation (unit). The popup flow goes into the e2e.

---

### Task 9: Build, manifests, icons, lint, signing, the fixture check

**Files:** `extension/build.mjs`, `extension/manifest.*.json`, `extension/tsconfig.json`, `extension/README.md`, `package.json` scripts (`ext:build`, `ext:lint`, `ext:sign`, `ext:check`), `scripts/ext-check.ts`, `scripts/setup.ps1` (also builds the extension), `.dependency-cruiser.cjs` (content scripts don't import api-client; cruise `extension/src`), `tests/extension-build.test.ts`.

- `build.mjs [--e2e]`:
  - Bundles `background`, `content`, `generic` (iife), `popup/main` and `options/main` with esbuild-svelte (`css: 'injected'`).
  - Copies the HTML files, writes PNG icons (a generated "J" mark, from a small PNG encoder using `zlib`), and merges the manifests. The version comes from package.json.
  - `--e2e` also matches `http://127.0.0.1:4798/*`, so the browser tests can serve fixture pages, and sets the default server to `http://127.0.0.1:4799`.
- `ext:lint`: `web-ext lint -s extension/dist/firefox --self-hosted`.
- `ext:sign`: `web-ext sign --channel=unlisted -s extension/dist/firefox --artifacts-dir extension/dist/signed`. With no keys, it stops with: "Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET first. See extension/README.md."
- `ext:check -- FILE URL`: runs the extractor for URL on a saved HTML file, and prints what it found. This is for checking your own saved pages.

Tests:
- The build produces both manifests (Firefox has `background.scripts` and the gecko id; Chrome has `service_worker`). All referenced files exist.
- `web-ext lint` passes with no errors.
- The dependency rule's planted-violation test.
- `ext:check` on a fixture prints the title.

---

### Task 10: Browser tests with the real extension (Chromium)

**Files:** `tests/e2e-extension/extension.spec.ts`, `tests/e2e-extension/serve-sites.ts`, `playwright.config.ts` (a third project, `extension`, using a persistent Chromium context with `--load-extension=extension/dist/chrome-e2e`).

The fixture site server on 4798 serves:
- `/seek/job/81234567`
- `/seek/jobs?jobId=…`: a search page whose cards change the URL with `history.pushState` and swap the right pane
- `/linkedin/jobs/view/…`
- `/indeed/viewjob?jk=…`
- `/other/article`

Tests:
- **The Phase 3 goal, part 1:** open the Seek search page and click through five cards. Each shows "Good match · 72" for that job's title, and only the last rating request is still running at the end.
- **The goal, part 2:** on a Seek job page, the panel shows **Save**. One click (status Applied) shows "Saved · Applied {today}". The dashboard (4799) has the job, with source `extension` in its history.
- Opening the same job again shows "Saved · Applied …".
- With the app stopped (port 4799 closed for that test), the panel shows the offline sentence.
- The popup saves `/other/article` through **Save this page**.

Firefox extensions can't be loaded by Playwright, so Firefox is covered by `web-ext lint` here, and by the Windows checklist.

---

### Task 11: Docs, checklist, final review

- **Architecture:**
  - §11: the real file names, the messages, CORS and nosniff, the e2e build.
  - §6.5: `extract` is synchronous, and the watcher waits.
  - §13: CORS and nosniff.
  - §14: extension e2e in Chromium.
  - §15: the content-script rule.
- **plan.md:** nothing changes, unless a ruling does.
- **README:** "The browser extension" (installing in Firefox: temporary, then signed; Chrome: Load unpacked; options; shortcut).
- **`docs/checklists/phase-3-windows.md`:**
  - `setup.bat` builds the extension.
  - Load it temporarily in Firefox. Real Seek, LinkedIn and Indeed job pages and split views, clicking quickly through 5 results.
  - With the app stopped.
  - Popup on another site; `Alt+Shift+J`.
  - Signing with your AMO keys and installing the `.xpi`.
  - Chrome Load unpacked.
  - `npm run ext:check` on pages you save.
- Run `npm test`, `npm run test:e2e` and `npm run ext:lint`.
- Final fresh Opus review; fix every critical and important finding with a failing test first. Update CLAUDE.md.
