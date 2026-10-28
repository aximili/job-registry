# Phase 1: Windows checklist

The app was built and tested on macOS. These steps check the parts that only Windows can run: the `.bat` and `.ps1` scripts, the shortcuts, and the window behaviour. Tick each one on your PC.

## Setup

- [x] **Node.js:** `node -v` in a terminal shows v24 or later. If not: `winget install OpenJS.NodeJS.LTS`. (Found Node.js v26.12.1)
- [x] **`setup.bat` finishes** with "All set." It should install packages, build the dashboard and create `config\settings.json`. No C++ build tools should be needed.
- [x] **Desktop shortcut:** answer Y to the question. The shortcut "Job Registry" appears and starts the app.
- [ ] **Start at log-in:** answer y to the question. Sign out and back in. The server starts minimised, and no browser opens. (I chose not to atm)

## Starting and stopping

- [x] **`start.bat`** opens the dashboard at http://127.0.0.1:4777/ within about 5 seconds.
- [x] **Run `start.bat` again:** no second "Job Registry server" window appears, and the dashboard just opens again.
- [x] **`stop.bat` while the app is running** prints "Job Registry stopped.", and the server window closes. (If it says "wasn't running" while the window is still open, note it down.)
- [x] **Run `start.bat`, then close the "Job Registry server" window:** start it again and check your data is all still there.
- [x] **A broken settings file:** edit `config\settings.json` and delete a comma, then run `start.bat`. It should say the server didn't start, show a sentence naming the file and the problem, and leave your file as it was. Put the comma back.
- [ ] **No garbled characters** (changed after your test): repeat the broken-settings test with a status label that's too short, such as `"label": ""`. The message shows plain characters such as `-` and `->`, not boxes or `â€"`.

## The recruiter-call test

- [ ] **Add a job:** click **New job** and paste a real Seek ad's text. Fill in the role and company, then save.
- [ ] **Log a call:** on that job, press `L`. Type a new person's name, choose "New person", add a phone number like `0412 345 678`, type a note, then press `Ctrl+Enter`.
- [ ] **Find it by phone:** close the browser tab. Open the dashboard again and type `345 678`. The job is first in the list in under 2 seconds.
- [ ] **Find it by company:** type the first three letters of the company. The job is in the list.

## Keyboard

- [ ] **Status with the keyboard:** on a job, press `S`, then the down arrow three times, and wait a moment. The timeline shows **one** status change, not three. Then press `L`: the Log call dialog opens.
- [ ] **Esc on the status list** before it saves puts the old status back.
- [ ] **Log call for someone already on the job:** type their name, skip the suggestion list, and save. There is still only one of them under People.
- [ ] **A phone number from Outlook or Teams:** copy a number from an email signature or a Teams chat, and paste it into search. It finds the job.

## Upgrading later

- [ ] **Run `setup.bat` while the app is running.** It should stop straight away with "Job Registry is running. Run stop.bat first, then run setup.bat again.", before it installs anything. (Setup can't replace the database driver while the app is using it.)
- [ ] **Then stop the app and run `setup.bat` again.** It finishes with "All set." and your jobs are still there.

## In Firefox

- [ ] **Search shortcuts:** `/` and `Ctrl+K` jump to the search box. Firefox's own quick find and search bar don't open.
- [ ] **Paste a link:** paste a Seek link into New job. Seek will probably refuse the download. The app should say so and ask for the ad text, and pasting the text into **Ad text** should still save the job.

Write down anything that doesn't match, and bring it to the next session.
