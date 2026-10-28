# Job site pages for the extension's tests

The extension reads the job page you have open. These pages let its tests check each site's extractor without a browser or the internet.

- **Hand-made** (from each site's known page structure, October 2026): `seek-job.html`, `seek-search.html`, `linkedin-job.html`, `linkedin-search.html`, `indeed-job.html`, `indeed-search.html`, `generic-jsonld.html`, `generic-article.html`. Seek and Indeed refuse downloads from a server, so these follow their published structure rather than a saved copy.
- **Real:** `linkedin-guest-job.html` is a LinkedIn job page as seen when signed out, saved 28 Oct 2026 and trimmed (scripts, styles and images removed).

## When a site changes its layout

Save the page from your browser (File → Save Page As → "Web Page, HTML only"), then run:

```
npm run ext:check -- path\to\saved-page.html "https://www.seek.com.au/job/81234567"
```

with the page's real address. It prints what the extractor found. If a field is missing, put the saved page here, add a test for it, and fix the selectors in `extension/src/sites/<site>.ts`.
