# Phase 3: Windows checklist (the browser extension)

The extension was built and tested on macOS: Chrome-style tests with the real extension in Chromium, on copies of the three sites, and Mozilla's checks for Firefox. These steps check what only your PC and the real sites can: Firefox itself, signing, and the real, signed-in pages of Seek, LinkedIn and Indeed. Tick each one.

Before you start: stop the app with `stop.bat`, run `setup.bat` (it now builds the extension too), then start the app.

## Installing in Firefox

- [ ] **Temporary install:** in Firefox go to `about:debugging#/runtime/this-firefox`, press **Load Temporary Add-on…** and pick `extension\dist\firefox\manifest.json`. It loads with no errors, and the toolbar shows the blue "J" button.
- [ ] **Permission:** open the extension's options (`about:addons` → Job Registry → Preferences). It doesn't say "isn't allowed to reach Job Registry". If it does, press **Allow access** and confirm.
- [ ] **Signing (when you have your addons.mozilla.org keys):** follow [extension/README.md](../../extension/README.md). `npm run ext:sign` makes a `.xpi` in `extension\dist\signed\`. Install it, restart Firefox, and the extension is still there.

## Seek (signed in)

- [ ] **A job page** (`seek.com.au/job/…`): the panel appears in the bottom-right corner within a few seconds, with the job's title and company. It offers **Save**.
- [ ] **Save in one click:** choose Applied and press **Save**. It says "Saved · Applied {today}". The dashboard has the job, with the salary from the ad.
- [ ] **The search page with a job open on the right:** click through 5 results, quickly. The panel follows each job: its title, then "Good match · …" (with your master profile) or a note that ratings need one. It never shows one job's title or rating while another is open.
- [ ] **Open a job you saved:** the panel says "Saved · Applied …" and the toolbar button shows ✓.

## LinkedIn (signed in)

- [ ] **From the feed:** go to linkedin.com, then Jobs, then click a job, all without reloading. The panel appears for the job.
- [ ] **A job page** (`linkedin.com/jobs/view/…`) and **the search page** with a job open on the right: title, company and location are right, and **Save** works.
- [ ] **The same job as one you saved from Seek:** the panel asks "Looks like … Same job?" **Same job** adds the ad to it.

## Indeed

- [ ] **A job page** (`au.indeed.com/viewjob?jk=…`) and **the search page** with a job open on the right: title, company and location are right (no "- job post" at the end of the title), and **Save** works.

## When things go wrong

- [ ] **App not running:** stop the app with `stop.bat` and open a job page. The panel says "Job Registry isn't running. Start it, then press Try again." Start the app and press **Try again**: it works.
- [ ] **A page it can't read:** if the panel ever says "Couldn't read this job", select the ad text and press **Save selection**. The job saves with that text. Then save that page (**File → Save Page As**, "Web Page, HTML only") and run `npm run ext:check -- path\to\page.html "the page's address"`. Bring the output to the next session.
- [ ] **Hide:** press **Hide** (or Esc in the panel). It shrinks to a small bar, the cursor stays on **Show**, and it stays that way on the next job page. **Show** brings it back.
- [ ] **Keyboard:** on a job page, press Tab until you reach the panel (it's last on the page). You can choose a status, type a note and press **Save** with the keyboard alone.
- [ ] **A first rating while the AI is off (Firefox):** with the pill on "AI off", open a job page. The rating appears once Bonsai has loaded (it can take a minute), or the panel says to reload the page. Note which one.
- [ ] **After updating the extension:** with a job page open, reload the extension (about:debugging → Reload). Reload the job page: there's one panel, not two.

## The toolbar button

- [ ] **Another website:** open a job ad on a company's careers page. Press the toolbar button (or `Alt+Shift+J`), then **Save this page**. It shows the title and the start of the ad. **Save** saves it.
- [ ] **Options:** change **Rate jobs automatically** off. Job pages no longer show "Rating…". Turn it back on.

## Chrome (optional)

- [ ] `chrome://extensions` → **Developer mode** → **Load unpacked** → `extension\dist\chrome`. A Seek job page shows the panel, and **Save** works.
- [ ] **A first rating while Bonsai is still loading** (the AI was off): the rating appears, or the panel asks you to reload the page. Note which one.

Write down anything that doesn't match, and bring it to the next session.
