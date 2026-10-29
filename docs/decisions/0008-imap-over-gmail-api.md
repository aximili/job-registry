# 0008 — Read Gmail over IMAP with an app password

**Status:** Accepted (28 Oct 2026). Rechecked at the start of Phase 5 (28 Oct 2026): Google still offers app passwords for accounts with 2-Step Verification, with no end date. They're "not recommended", they're cancelled when the Google password changes, and work or school accounts may not offer them. IMAP is always on for personal Gmail since January 2025. Built in Phase 5 (29 Oct 2026).

## Context
The bonus Gmail feature reads recruiter emails and suggests status changes, which you confirm. It's for personal use, on one account.

## Decision
- **How it connects:** `ImapMailSource` uses Gmail IMAP over TLS (`imapflow`), with a Google app password, which needs 2-Step Verification.
- **Access:** read-only (the mailbox is opened with EXAMINE). Only short summaries are stored, never full emails.
- **Tests:** the adapter is tested against hoodiecrow-imap, a strict IMAP server for tests from the makers of imapflow. A real Gmail login is checked on the Windows PC.

## Other options considered
- **The Gmail API with OAuth.** The "proper" route, but it needs a Google Cloud project and a consent screen. A personal app stays in Google's "testing" mode, where refresh tokens expire every 7 days, so you'd have to sign in again each week.

## Consequences
- Setup is pasting one password into Settings.
- Google might restrict app passwords further. Because email sits behind the `MailSource` port, a Gmail API adapter can replace IMAP without changing anything else.
