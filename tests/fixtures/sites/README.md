# Job site pages for the extension's tests

The extension reads the job page you have open, and the job cards in a search list. These pages let its tests check each site's extractor without a browser or the internet.

- **Hand-made** (from each site's known page structure, October 2026): `seek-job.html`, `seek-search.html`, `linkedin-job.html`, `linkedin-search.html`, `indeed-job.html`, `indeed-search.html`, `generic-jsonld.html`, `generic-article.html`. Seek and Indeed refuse downloads from a server, so these follow their published structure rather than a saved copy.
  - The search pages have a job open on the right and a list of cards. `linkedin-search.html` (signed in) has a normal card, a "Promoted" card with a salary, and a card LinkedIn hasn't filled in yet. `indeed-search.html` has a card with a salary and snippet bullets, a plainer one, and a sponsored card with no job key.
- **Real:**
  - `linkedin-guest-job.html` is a LinkedIn job page as seen when signed out, saved 28 Oct 2026 and trimmed (scripts, styles and images removed).
  - `seek-job-real.html` is a Seek job page at au.seek.com, saved 29 Oct 2026 and trimmed (scripts other than the JobPosting data, styles, images and class names removed). Seek now serves jobs from au.seek.com and nz.seek.com, and the older www.seek.com.au refused the download.
  - `seek-search-real.html` is a Seek search page at au.seek.com (Full Stack Developer jobs in Melbourne), saved 29 Oct 2026 signed out and trimmed the same way, to its first 10 job cards. The browser tests' Seek list (`tests/e2e/fixtures/seek-list.html`) copies three of its cards, so change both if Seek changes its cards.
  - `linkedin-guest-search.html` is a LinkedIn search page as seen when signed out (Full Stack Developer jobs in Melbourne), saved 29 Oct 2026 and trimmed to its first 10 job cards (scripts, styles and images removed; class names kept).

## When a site changes its layout

Save the page from your browser (File → Save Page As → "Web Page, HTML only"), then run:

```
npm run ext:check -- path\to\saved-page.html "https://au.seek.com/job/81234567"
```

with the page's real address. It prints what the extractor found: the job, then `Cards: N` and one line per job card (`<id>  <title> · <company> · <location>`). If a field or a card is missing, put the saved page here, add a test for it, and fix the selectors in `extension/src/sites/<site>.ts`.
