# Phase 4: Windows checklist (resumes and cover letters)

Resumes and cover letters were built and tested on macOS, against a fake AI. Browser tests ran in Firefox and Chromium. These steps check what only your PC can:

- your real master profile
- Bonsai writing real documents
- Firefox's Save to PDF
- a .docx in a Word-like app.

Tick each one.

Before you start: stop the app with `stop.bat`, run `setup.bat`, then start the app.

## Your profile

- [ ] **Starter files:** open Settings. The **Profile** section shows a resume guide and a cover letter guide. The **Templates** section shows `resume.css` and `cover-letter.css`. The app copied these in from `starters\` the first time it started.
- [ ] **Master profile:** paste your full resume (every job, result, skill and qualification) into **Master profile** and press **Save**. It says "Saved.", and `profile\master-profile.md` holds the same text.
- [ ] **Preferences:** fill in **Preferences** (roles, salary floor, locations, work mode, deal-breakers) and save.
- [ ] **Edit outside the app:** change `profile\resume-guide.md` in Notepad, then reload Settings. The change shows.

## Writing with Bonsai

- [ ] **Generate a resume:** open a saved job and press **New resume** in Documents, then **Generate resume**. Note how long Bonsai takes. The text arrives bit by bit, and the A4 preview follows.
  - [ ] Read it closely. Is every employer, title, date, number and certification really in your profile? Note anything invented, even when the fact-check list missed it.
  - [ ] No "thinking" text (the model reasoning to itself) appears in the document.
- [ ] **The fact-check:** add "Grew sales by 40%" to a bullet point. Within a second, "Not in your profile: 40%" appears above the text, and 40% is highlighted in the preview. Note any highlight that is wrong (a fact that is in your profile).
- [ ] **Stop:** press **Generate cover letter**, then **Stop** part-way. The text so far stays and nothing is saved. The AI pill goes back to Ready.
- [ ] **Close the tab while it writes:** press **Generate resume**, then close the Firefox tab part-way. Open the job and press **New resume** again. It offers "You have unsaved text from …", and **Restore** brings the text back. The AI pill goes back to Ready.
- [ ] **A long draft:** if a draft ends with "sent nothing for 300 seconds", raise `"timeoutSec"` under `"ai"` in `config\settings.json` (for example to 600) and try again. If it ends with "ran out of room", the AI's context is full (writing thinks with No limit): give llama-server a bigger `-c`, or pick High for "Writing resumes and cover letters" in Settings → AI. Note which one happened.
- [ ] **Save and send:** press **Save version**, then **Mark as sent** and confirm. The text becomes read-only, with "Sent on {today}".

## Print and export

- [ ] **Print to PDF in Firefox:** press **Print / PDF**. The page opens in a new tab. Press Ctrl+P, choose **Save to PDF** and A4, and untick **Headers and footers** (under More settings). The PDF looks like the preview, and it's named after you, the document and the company.
- [ ] **Export .docx:** press **Export .docx** and open the file in Word for the web or ONLYOFFICE. Headings, bullet points, bold text and links are right, the font is Calibri and the page is A4.

## The Phase 4 done criterion, by hand

- [ ] Two jobs each have their own sent resume.
- [ ] In Settings → Templates, change `resume.css`: for example, make `.document h1` red. Save it.
- [ ] Open each sent resume: the preview and **Print / PDF** still look as they did. A new, unsent version shows the red heading.

## Files and backups

- [ ] **Attach a real PDF:** on a job page, under Documents, choose a PDF you made before this app and press **Attach file**. It's listed, and its link downloads the same file.
- [ ] **A file that's too big or the wrong type:** attaching an `.exe`, or a file over 15 MB, gives a plain message, and nothing is listed.
- [ ] **A name with accents or emoji:** attach a file called something like `Résumé 🚀.pdf`. The list shows that name, and the download is saved with it.
- [ ] **Backups:** press **Back up now** in Settings. The backup folder now has a `files` folder holding your attached file, plus `profile` and `templates` folders with your master profile, guides and CSS.
- [ ] **A second backup is quick:** press **Back up now** again. It finishes at once, and the copied files keep their original dates, so nothing was copied again.
- [ ] **The call sheet:** the job's call sheet shows "Sent: Resume v1 (…)", with a link to it.
