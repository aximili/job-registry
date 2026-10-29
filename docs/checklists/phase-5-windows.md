# Phase 5: Windows checks (Gmail)

Input for the Windows handover, not a checklist to tick by hand.

Gmail reading was built and tested on macOS, against a test IMAP server (hoodiecrow-imap) and a fake mailbox, with a fake AI. Browser tests ran in Firefox and Chromium. These checks need the Windows PC, a real Gmail account and Bonsai 2.

## Connecting

- **Settings → Email:** tick "Check Gmail for emails about your jobs", enter the Gmail address, paste a real app password, and press **Test connection** (it saves them first). It says "An app password is saved." and `config\secrets.json` holds the password without spaces.
- **Test connection:** says "Connected to imap.gmail.com as <address>." within about 10 seconds.
- **TLS on Windows:** if it says "Can't check imap.gmail.com's certificate…", antivirus email scanning is swapping the certificate. Note which antivirus. Option to try (not built in): start the server with Node's `--use-system-ca`, so it trusts the Windows certificate store.
- **A wrong app password:** gives "Gmail refused the address or app password…". Note Gmail's exact words for any other refusal ("Gmail refused the login: …").
- **The password never shows:** `GET http://127.0.0.1:4777/api/v1/settings` and `/api/v1/settings/secrets` don't contain it. `data\logs\app-*.log` doesn't contain it.

## Checking real mail

- **First check:** press **Check now** in the Inbox, in Firefox. Note how long it takes and how many cards appear. It reads only the last 14 days. If it takes over about 300 seconds, Firefox may show "Can't reach Job Registry…" while the check carries on; the page corrects itself when it ends. Note whether that happens.
- **Bonsai reading real emails:** for each card, note whether the event (rejection, interview…) and the job are right, and whether the summary is sensible. Note the time per email: `data\logs\app-*.log` has a "Checked email" line with `read`, `added` and `ms`.
- **Real rejection wording:** note any real job email that didn't make a card (wording like "decided not to proceed" or "regret to inform" may need adding to the filter).
- **Nothing marked read:** in Gmail, the emails the app read are still unread if they were unread before.
- **Nothing kept:** the database holds no email bodies: `SELECT * FROM email_suggestions` shows only sender, subject, date, summary, company and role.
- **Confirm:** on a real card, **Confirm** changes the job's status and adds one note starting "Email, ".
- **The timer:** leave the app running for 30 minutes with email on. The log shows a check about every 10 minutes and no errors.
- **Stop during a check:** press **Check now**, then run `stop.bat` at once. The app stops within a few seconds, and the next start checks again with no duplicate cards.
- **The AI off:** in Settings → AI, untick "Start it for me when it isn't running" and set the address to `http://127.0.0.1:9/v1` (nothing listens there), then **Check now** in the Inbox. It says "Waiting for the AI: …" and makes no cards. Put the AI settings back and check again: the cards appear.
