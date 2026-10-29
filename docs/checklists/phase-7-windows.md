# Phase 7: Windows checks (quick marks on search lists)

Input for the Windows handover, not a checklist to tick by hand.

Quick marks were built and tested on macOS, with a fake AI. The readers were tested on real Seek and LinkedIn lists saved while signed out, and on hand-made Seek, signed-in LinkedIn and Indeed lists. The browser tests ran the real extension in Chromium, on a copy of a Seek list. These checks need the Windows PC, Firefox, Bonsai 2 and your signed-in job sites.

Before you start: the master profile is in Settings → Profile, and the extension's option "Rate the jobs in search results (a quick rating from each card)" is ticked (it is by default).

## After updating the extension

- **Firefox's permissions:** open `about:addons` → Job Registry → **Permissions**. au.seek.com and nz.seek.com are allowed. Firefox may not grant new sites on an update, so turn them on if they're off.
- **Jobs saved from Seek's new addresses before the fix:** a job saved from au.seek.com or nz.seek.com before 29 Oct 2026 keeps that link, so its card won't say "Saved" ("Same job?" still catches a re-save). Count them, and note the number in the results. In PowerShell, in the app folder:
  ```
  node -e 'const D=require(`better-sqlite3`);const db=new D(`data/jobs.db`,{readonly:true});console.log(db.prepare(`SELECT COUNT(DISTINCT job_id) AS n FROM postings WHERE canonical_url LIKE ? OR canonical_url LIKE ?`).get(`https://au.seek.com/%`,`https://nz.seek.com/%`).n)'
  ```
  It prints one number. (By hand: on each Seek job in the dashboard, the "Open the original ad" link starts with https://au.seek.com/ or https://nz.seek.com/.)

## Marks on real lists (signed in)

- **Seek, LinkedIn and Indeed:** search for a job you'd apply for. Within a minute, the cards on screen get a mark after their title, one card after another: "Rating…", then a verdict and score such as "Good 68 · quick".
- **LinkedIn signed out:** the same on LinkedIn's search page when you're not signed in.
- **Jobs you saved:** a card for a job you saved says "Saved" or "Saved · Applied 12 Oct" at once, with no "Rating…" first.
- **Jobs you opened before:** a card for a job you opened and rated (but didn't save) shows that full rating at once, with no "· quick".
- **The tooltip:** point at a quick mark in Firefox. The tooltip gives the AI's one-line reason, then "Quick rating from the card. Open the job for a full rating." Does the reason fit that card's job?
- **Cards that aren't jobs** (adverts, "jobs you may like" banners, Indeed's sponsored cards with no job link) get no mark.

## Marks that come back, once

- **Scrolling (LinkedIn):** scroll down a long list. The cards that load as you scroll get marks too. Scroll back up: each card still has its mark, and no card has two.
- **Seek redraws a card:** press a card's save (heart) button on Seek. Seek redraws the card. Its mark comes back within a second or two, and there's only one.
- **Another page of results, then Back:** the new page's cards get marks. Back on the first page, its marks show at once (they're kept).
- **A new search while a card shows "Rating…":** the new list's cards get marks. No card gets a mark that belongs to another job (check two or three tooltips).

## Opening and saving from the list

- **Open a job from the list** (the split view on Seek, LinkedIn or Indeed). Once the panel shows its full rating, the card's mark changes to the full one (no "· quick").
- **Save it from the panel:** its card says "Saved" (or "Saved · Applied …") at once.
- **The open job comes first:** open a job while the cards are still being rated. Its rating in the panel waits for one card at most, not for the whole list.
- **LinkedIn job pages:** open a job on its own LinkedIn page (not a search). The "similar jobs" cards on it get marks too. The panel still appears within a few seconds, and its rating waits for one card at most.

## Full ratings still make sense

The rules for a full rating moved into the user part of its prompt, so both kinds of rating share the start of the prompt. That was tested only with a fake AI.

- **Two or three jobs you know:** open the job pages of two or three jobs whose fit you already know (a good fit and a poor one). Each verdict matches its score band: strong 80+, good 60–79, stretch 40–59, weak under 40. The panel shows "Why it fits" and "Why it might not", and the reasons make sense for that job.
- **If not,** write a bug. The fallback (in the Phase 7 ledger) is to move the rules back to the system part, and accept a slower switch between full ratings and quick marks.

## Bonsai 2's time per card

- **Time it:** note how many seconds pass between one mark and the next on a 20-card list. Note it for the first card too, when Bonsai 2 had nothing to do just before.
- **After a full rating:** open a job, wait for its rating, then go back to the list. Are the next cards as quick as before? (Both kinds of rating share the start of the prompt, so llama-server's cache should serve both.)
- **The handover times one card too** (`ai-smoke`, "the AI gives a job card a quick mark").
- **Where to change it:** Settings → AI → "How the AI works on each task" → "Quick marks on search lists" (Thinking Off and Longest answer 512 by default). It changes quick marks only, not full ratings or resumes.

## Only the tab in front

- **Two search tabs:** open two different searches in two tabs. Only the tab you're looking at gets new marks. Switch tabs: the other one carries on where it stopped.
- **Firefox minimised:** while Firefox is minimised, or another window covers it, note whether marking pauses (Windows may or may not tell Firefox the tab is hidden).

## When things go wrong

- **The app stops:** run `stop.bat` while cards are being rated. The marks already there stay. No card is left on "Rating…", and nothing more is asked. Start the app, switch to another tab for a few seconds, then come back: the rest of the cards get marks.
- **The option off:** untick "Rate the jobs in search results (a quick rating from each card)" in the extension's options. Reload the list: no marks and no "Rating…". Tick it again.

## How the marks look

- **Under each site's titles:** on Seek, LinkedIn (signed in and out) and Indeed, the mark sits right after the title. Where the title is a heading, the mark may sit on its own line under it. Does it look tidy, and does it push anything out of place?
- **Dark mode:** the marks follow Firefox's "Website appearance" (Firefox Settings → General; "Automatic" follows Windows' own light or dark mode), not the site's colours. With Firefox dark and the site light (and the other way round), is each mark still easy to read?
- **Clicking:** note what clicking a mark does. Clicking anywhere else on the card still opens the job as before.
- **A long list stays smooth:** scrolling a LinkedIn list of 50 or more jobs doesn't stutter.

## If a site shows no marks

Save the list page (**File → Save Page As**, "Web Page, HTML only") and run `npm run ext:check -- path\to\page.html "the page's address"`. It prints `Cards: N` and one line per card. Bring the output and the page to the next session.
