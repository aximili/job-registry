# 0013 — Rewriting a document from a short note

**Status:** Accepted (13 Nov 2026). Built after Phase 9 (13 Nov 2026). It extends [0012](0012-writing-ai-and-briefs.md).

## Context
- Phase 9 can write a resume or cover letter from a brief, but the user often wants a smaller change to a draft already in front of them.
- A rewrite should not need a new document type, a new origin label, or a new database migration.
- The feature still has to follow the same rules as normal writing: the writing AI, the budget, fact-checking, the shared prompt cache, and no extension access.

## Decision
- **Rewrite the editor's current draft from a note.** The user types one short note, presses **Rewrite with my note**, and the writing AI returns new text for the editor draft.
- **No new saved document kind, origin or table.** Saving a rewrite uses the existing document version path, and its origin is `edited`.
- **The note is throwaway.** It is used for one rewrite and is not stored with the job.
- **The current draft is part of the request.** The rewrite receives the note, the draft, the job, the ad, the profile, notes, guide and the newest brief for that kind. It does not mark the brief approved.
- **The note has a 1,500-character cap.** The draft uses the existing document limit, and the normal request-size budget still applies.
- **Rewrites share the draft key with normal writes.** For the same job and document kind, a new rewrite replaces an older rewrite or generation in flight, so the newest user action wins.
- **Revert is the undo path before saving.** After saving, the existing version dropdown remains the undo path.
- **The two rewrite prompts share the existing writing system part.** There are now six writing prompts: brief, plan, resume, cover letter, resume rewrite and cover-letter rewrite. This keeps the local and cloud prompt-cache benefit.
- **Dashboard-only.** The rewrite route uses the writing AI, so the extension cannot start it.

## Consequences
- A rewrite is a draft action, not a saved edit. Nothing is written to the database until the user presses **Save version**.
- The editor can show a new unsaved draft from the note, then revert it if the result is wrong.
- The feature needs a live check with Strata or Bonsai 2 on the real profile to prove timing and budget behavior.