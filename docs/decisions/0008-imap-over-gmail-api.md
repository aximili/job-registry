# 0008 — Read Gmail over IMAP with an app password

**Status:** Accepted (28 Oct 2026). Recheck at the start of Phase 5.

## Context
The bonus Gmail feature reads recruiter emails and suggests status changes, which you confirm. It's for personal use, on one account.

## Decision
- **How it connects:** `ImapMailSource` uses Gmail IMAP over TLS (`imapflow`), with a Google app password, which needs 2-Step Verification.
- **Access:** read-only. Only short summaries are stored, never full emails.

## Other options considered
- **The Gmail API with OAuth.** The "proper" route, but it needs a Google Cloud project and a consent screen. A personal app stays in Google's "testing" mode, where refresh tokens expire every 7 days, so you'd have to sign in again each week.

## Consequences
- Setup is pasting one password into Settings.
- Google might restrict app passwords further. Because email sits behind the `MailSource` port, a Gmail API adapter can replace IMAP without changing anything else.
