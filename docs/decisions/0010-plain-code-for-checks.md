# 0010 — Plain code, not AI, for duplicate matching and the fact-check

**Status:** Accepted (28 Oct 2026)

## Context
- "Have I already saved this job?" must answer instantly, while you're on the page.
- The resume fact-check must re-run as you type.
- Both need to behave the same way every time.

## Decision
- **Duplicate matching:** plain code in `server/modules/jobs/match.ts`. It matches exactly on the canonical URL or the site's job ID. A "likely" match needs the same company name, after removing endings like "Pty Ltd", and a close title. A weak "possibly" match uses title and location for agency reposts.
- **Fact-check:** plain code in `shared/fact-check.ts`. It flags numbers, percentages, money, dates and capitalised names in the draft that don't appear in the master profile, allowing for formatting differences.

## Other options considered
- **AI for both.** Catches more subtle cases, but takes seconds rather than milliseconds, gives different answers from run to run, and keeps the GPU busy.

## Consequences
- Both are instant, predictable and easy to unit-test.
- The fact-check misses invented claims that contain no number or name ("led a large team"). That's accepted: the check is a helper, not a gate, and you still review every document.
