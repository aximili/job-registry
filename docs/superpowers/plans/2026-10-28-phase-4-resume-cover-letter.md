# Phase 4 — Resume and Cover Letter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For any saved job, generate a tailored resume and cover letter from your master profile, streamed into an editor (text on the left, a live A4 preview on the right) with light fact-check highlights. Save as many versions as you like. Mark one as sent, which freezes it with the template CSS as it was then. Print it to PDF, or export a .docx. Attach files you made elsewhere. Edit your profile, guides and templates in Settings.

**Architecture:** architecture §4 (`documents`, `profile`), §6.4 (`DocumentExporter`), §7.4, §8 (`DOCUMENTS`, `ATTACHMENTS`), §10, §12.1 (`writeDocument`, thinking on, streamed).
- The `documents` module (composite: `ai`, `profile`, `jobs`) owns the two tables and `data/files/`.
- `shared/markdown.ts` (marked, raw HTML escaped) renders the same way in the browser preview, the print view and the .docx export.
- `shared/fact-check.ts` runs in the browser as you type.
- The call sheet shows the sent resume and cover letter.

**Tech stack:** as before, plus `marked` 18 (shared), `docx` 9 (server) and `@fastify/multipart` (attachments).

**Spec:** docs/plan.md ("Resume and cover letter", Phase 4: done when "two jobs each have their own sent resume, and changing resume.css afterwards doesn't change how either sent version looks"), docs/architecture.md (§4, §6.4, §7.4, §8, §9, §10, §12, §13). CLAUDE.md "Notes for Phase 4".

## Global Constraints

- Everything in the earlier plans' Global Constraints still holds.
- **Documents are append-only.** Every **Save version** inserts a row. A sent version can't be changed: the repo refuses, with `ConflictError` "This version was sent, so it can't be changed. Save a new version instead."
- **Mark as sent** stores `sent_css` (the template's text at that moment) and `sent_at`. Rendering a sent version uses `sent_css`, never the current template.
- **The AI never invents experience.** The prompts say to use only facts from the master profile, never invent numbers, and use Australian spelling. The fact-check flags numbers, percentages, money, years and date ranges, and capitalised names that aren't in the profile, allowing for formatting differences ("30 %" vs "30%", "2019–2021" vs "2019-2021"). It never blocks saving or sending.
- **Thinking** is on for documents (`reasoning_effort: "medium"`); thinking text is never put into a document (Phase 2's adapter splits it out).
- **Markdown** is rendered by `shared/markdown.ts`. Raw HTML in it is escaped, and links are only http(s) or mailto. The preview is a sandboxed iframe (`sandbox=""`, so no scripts). The print view is served with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:`.
- **Profile files** live in `profile/` (git-ignored), and templates in `templates/` (git-ignored). Starters are tracked in `starters/profile/` and `starters/templates/`, and copied in by setup (and at server start) only when a file is missing. Writes to profile and template files are `dashboardOnly`.
- **Attachments** go to `data/files/<jobId>/<id>-<safe name>`. The limits are 15 MB and PDF, DOCX, DOC, RTF, TXT or ODT. The name is cleaned: no path parts, no control characters, at most 100 characters. Downloads use `Content-Disposition: attachment`.
- **Backups** also copy `data/files/` to `<backupDir>/files/` (architecture §13).
- **Migration** `003_documents.sql`, with a test. Never edit 001 or 002.

## Review Focus

1. **A sent document stays exactly as sent.** Editing `resume.css` after sending changes neither the preview nor the print view nor the .docx of the sent version. A save never touches a sent row. → Tasks 2, 3, 6
2. **The AI adds things that aren't in the profile.** A new employer name, a made-up percentage or a certification shows in the fact-check list ("Not in your profile: …") and is highlighted in the preview. Facts that are in the profile, written differently, aren't flagged. → Tasks 1, 7
3. **Markdown with HTML or scripts in it** (pasted from somewhere, or from the AI). It shows as text, never runs, and never loads anything, in the preview, the print view and the .docx. → Tasks 1, 3, 7
4. **Generation stopped part-way** (you press Stop, close the tab, or the AI fails). What arrived so far stays in the editor, unsaved but not lost, and nothing is saved by itself. Thinking text never appears. → Tasks 4, 7
5. **A strange attachment** (a 200 MB file, `..\..\evil.exe`, a name with emoji or slashes). A clear refusal or a cleaned name; it never writes outside `data/files/`. → Task 5

---

### Task 1: Shared Markdown and the fact-check

**Files:** `shared/markdown.ts`, `shared/fact-check.ts`, tests next to them. `.dependency-cruiser.cjs` already allows `marked` in shared/.

- `renderMarkdown(md: string): string`: marked (GFM, line breaks on). Every raw HTML token is escaped as text. Links other than `http(s):` and `mailto:` become plain text. Images are refused (shown as their alt text).
- `factCheck(draft: string, profile: string): { flagged: { text: string; kind: 'number' | 'percent' | 'money' | 'year' | 'range' | 'name'; start: number; end: number }[] }`.
  - It extracts tokens from the draft. These are numbers, percentages, money ($, k, m), years (19xx/20xx), date ranges (2019–2021, Jan 2020 – Mar 2022) and capitalised names. A name is a run of capitalised words not at a sentence start, or any capitalised word with a digit or a capital inside it (AWS, PowerBI, ISO27001).
  - It normalises both sides: case, spaces, dashes (– — - become -), "%" spacing, and commas in numbers. A token is flagged when its normalised form isn't in the normalised profile.
  - Common words ("I", "Dear", month names, day names, Australian state abbreviations, and the words of the job title and company from the ad, which is passed in as `allow: string[]`) are never flagged.

Tests:
- Invented numbers and names are flagged.
- "30 %" vs "30%" and "2019–2021" vs "2019-2021" aren't.
- The employer and job title from the ad (`allow`) aren't.
- Markdown with `<script>`, `<img onerror>`, `javascript:` links and raw `<iframe>` renders as escaped text, with no tags.

---

### Task 2: Migration 003, documents repo and service (versions, sent, copy)

**Files:** `server/core/db/migrations/003_documents.sql`, `server/modules/documents/{index,service,repo,routes}.ts`, `shared/contracts/documents.ts`, tests.

```sql
CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  kind TEXT NOT NULL,                -- resume | cover_letter
  version INTEGER NOT NULL,
  markdown TEXT NOT NULL,
  origin TEXT NOT NULL,              -- generated | edited | copied
  copied_from_id INTEGER REFERENCES documents(id),
  is_sent INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  sent_css TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (job_id, kind, version)
);
CREATE INDEX documents_job ON documents(job_id, kind, version);
CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  kind TEXT NOT NULL,                -- resume | cover_letter | other
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX attachments_job ON attachments(job_id);
```

`DocumentsService`:
- `list(jobId)`: newest first, per kind.
- `get(id)`.
- `saveVersion(jobId, { kind, markdown, origin })`: the next version number, in a transaction.
- `copyFrom(jobId, sourceDocumentId)`: copies the markdown as a new version with origin `copied`.
- `markSent(id)`:
  - Freezes the CSS of `templates/<kind>.css` read through the profile service.
  - A second call is a no-op.
  - Marking v2 sent leaves v1 sent too, since you may send twice. The call sheet shows the latest sent.
- `latestSent(jobId)`: `{ resume?, coverLetter? }`.
- Events: `document.saved` and `document.sent`. Live forwards them.

Routes (architecture §9):
- `GET /jobs/:id/documents`
- `POST /jobs/:id/documents` `{ kind, markdown }` or `{ fromDocumentId }`
- `POST /documents/:id/sent`
- `GET /documents/:id`

Tests:
- Versions count up per job and kind.
- A sent document can't be changed: the repo has no update path, and `saveVersion` never touches old rows.
- markSent freezes the CSS. Changing the template file afterwards doesn't change `sent_css`.
- copyFrom works across jobs.
- The migration upgrades a version 2 database with data.

---

### Task 3: Rendering, print view and exporters

**Files:** `server/modules/documents/exporters/{print-html,docx}.ts`, `server/modules/documents/render.ts`, routes, tests.

- `renderDocument(doc, css)` builds a full A4 HTML page: `@page { size: A4; margin: … }` from the template, `renderMarkdown`, and the title "{Your name} – Resume – {Company}". The name is the master profile's first `# ` heading.
- `DocumentExporter` (§6.4): `PrintHtmlExporter` (`text/html`) and `DocxExporter`:
  - It walks marked's tokens into `docx` paragraphs, headings, bullet lists, bold, italic and links.
  - It has fixed fonts (Calibri 11) and A4 page size.
- Routes:
  - `GET /documents/:id/render` serves the print page with the strict CSP above, using `sent_css` for a sent version.
  - `GET /documents/:id/export?format=docx` serves `application/vnd.openxmlformats-officedocument.wordprocessingml.document` with a cleaned file name.
  - `GET /documents/exporters` lists the buttons.

Tests:
- Render uses the frozen CSS for a sent document, even after the template file changes (the phase's done criterion, at API level).
- Render has the CSP header, and escapes HTML in the Markdown.
- The docx export is a valid zip with `word/document.xml` containing the headings and bullets.

---

### Task 4: AI writeDocument (streamed) and generate

**Files:** `server/modules/ai/tasks/write-document.ts`, `server/modules/ai/prompts/{write-resume,write-cover-letter}.md`, `server/modules/ai/service.ts` (`writeDocument`), `shared/contracts/ai.ts` (tasks.write: temperature 0.6, maxTokens 8192, thinking true), `server/modules/documents` (generate), tests.

- `ai.writeDocument({ kind, profile, guide, job, ad }, { signal }): AsyncIterable<string>`.
  - It runs at interactive priority, with thinking on, through the queue. The queue holds the GPU until the stream ends or is aborted.
  - It yields only `text` chunks.
- Prompts (rules, in plain English):
  - Use only facts from the master profile. Never invent employers, titles, dates, numbers or certifications.
  - Follow the guide.
  - Tailor the order and emphasis to the job's requirements.
  - Australian spelling, and Markdown only.
  - Resume: a `# Name` heading, contact line, summary, experience, skills, education. Cover letter: under one page.
- `POST /jobs/:id/documents/generate { kind }` streams `text/plain; charset=utf-8` chunks. Closing the request aborts generation. Nothing is saved; the editor saves.
- The starter guides (`starters/profile/resume-guide.md`, `cover-letter-guide.md`) are short, editable advice.

Tests:
- The stream yields the fake AI's text, and none of its thinking.
- Closing the request aborts the queue task.
- The prompt has the profile before the job.
- Without a master profile, it's a 400: "Add your master profile first: Settings → Profile."

---

### Task 5: Attachments, and backups of files

**Files:** `@fastify/multipart` (dependency), `server/modules/documents` (attach, download), `server/modules/system/service.ts` (copy files on backup), tests.

- `POST /jobs/:id/attachments` (multipart: `kind`, `file`) and `GET /attachments/:id` (download).
- It cleans the file name and checks the limits (Global Constraints). The stored path is always under `data/files/<jobId>/`, checked after resolving.
- Backups mirror `data/files/` to `<backupDir>/files/`: new and changed files are copied, and nothing is deleted.

Tests:
- Upload and download round-trip.
- A 16 MB file is refused: "That file is over 15 MB."
- `../../evil.exe` is refused: "Attach a PDF, Word or text file."
- `..\\..\\cv.pdf` is stored as `cv.pdf` inside the job's folder.
- A backup copies the file.

---

### Task 6: Profile and template editing; the call sheet's sent documents

**Files:** `server/modules/profile` (`write(name, text)`, routes, starters copy), `starters/`, `server/modules/callsheet` (`documents` dependency, now allowed in §4.2), `shared/contracts/callsheet.ts`, tests.

- Names:
  - `master-profile`, `preferences`, `resume-guide` and `cover-letter-guide` are `.md` files in `profile/`.
  - `resume` and `cover-letter` are `.css` files in `templates/`.
- Routes:
  - `GET /profile/:name` → `{ name, text, updatedAt }`.
  - `PUT /profile/:name { text }` is dashboard-only, written with `replaceFile` (a temporary file, then a rename), and emits `profile.changed`.
- Starter copy at start-up: only for missing files, never overwriting.
- The call sheet gains `sent: { resume: DocumentSummary | null; coverLetter: DocumentSummary | null }`.

Tests:
- Read and write each name. An unknown name is a 404.
- An extension origin can't PUT.
- Starters are copied only when missing.
- The call sheet shows the latest sent.

---

### Task 7: Dashboard — documents on the job page, the editor, profile and templates in Settings

**Files:**
- `web/src/pages/DocEditorPage.svelte` (`/jobs/:id/documents/:docId`, and `/jobs/:id/documents/new?kind=`)
- `web/src/components/{DocumentsPanel,FactCheckList,DocPreview,AttachmentsPanel}.svelte`
- `web/src/lib/documents.ts`
- `web/src/pages/SettingsPage.svelte` (Profile and Templates sections), `CallSheet.svelte` (the sent documents), router
- e2e `tests/e2e/documents.spec.ts`

The editor:
- **Generate resume / Generate cover letter:** streams into the text area, with a **Stop** button. What arrived stays if it stops.
- **The preview:** an iframe with `sandbox=""` and `srcdoc` = the A4 page (the template's CSS, or the frozen CSS for a sent version), updated 300 ms after you type.
- **The fact-check:** runs 300 ms after you type. It lists "Not in your profile: …" above the editor, with `mark` highlights in the preview.
- **The version picker:** "Version 3 · edited · 28 Oct" and "Version 2 · sent 27 Oct".
- **Buttons:**
  - **Save version** (disabled when nothing changed).
  - **Mark as sent** (confirms first, then the version is read-only).
  - **Print / PDF** (opens the render URL in a new tab).
  - **Export .docx**.
  - **Start from another job's version** (a picker of your documents).
- A sent version's text area is read-only, with the note "Sent on {date}. Save a copy to change it."

The job page has a Documents panel with each kind's versions, and **Attach file**. The call sheet shows "Sent: Resume v2 (27 Oct) · Cover letter v1".

Settings → **Profile** (master profile, preferences, resume guide, cover letter guide) and **Templates** (resume.css, cover-letter.css): a text area for each, with **Save** and "Saved."

e2e tests (with the fake AI streaming a resume):
- Generate, edit, preview, save, then mark sent. Changing the template in Settings leaves the sent version's preview unchanged (**the done criterion**, through the UI).
- Two jobs each have their own sent resume, unchanged after a template edit.
- Fact-check flags an invented "40%" typed in.
- The print view renders.
- Attach a PDF and download it.
- Start from another job's version.

---

### Task 8: Docs, checklist, reviews

- Checkpoint review after Task 4; final review at the end (fresh Opus each). Fix every critical and important finding with a failing test first.
- **Architecture:** §4.2 (callsheet → documents is already shown), §8 (the tables as built), §9 (routes), §10 (the editor), §13 (attachments, CSP, file backups).
- **README:** "Resumes and cover letters" and "Your profile".
- **`docs/checklists/phase-4-windows.md`:**
  - Paste your real master profile.
  - Generate with Bonsai (time it, check for invented facts).
  - Print to PDF in Firefox (headers and footers off, A4).
  - Export .docx and open it in Word for the web or ONLYOFFICE.
  - The done criterion by hand.
  - Attach a real PDF.
- **CLAUDE.md:** status, and notes for Phase 5 (the Gmail recheck result, below).

### Notes for Phase 5 (from research on 28 Oct 2026)

- Google's help page (support.google.com/accounts/answer/185833) still offers app passwords for accounts with 2-Step Verification, with no end date. It says they're "not recommended", and they're revoked when you change your Google password.
- IMAP is always on for personal Gmail accounts since January 2025 (no setting to turn on).
- Workspace (work or school) accounts no longer allow app-password IMAP. A personal Gmail is fine.
