# Phase 8: Windows checks (several AIs, switched in one click)

Input for the Windows handover, not a checklist to tick by hand.

Saved AIs, the AI pill's menu, API keys and the Claude connector were built and tested on macOS, against fake AI servers only: no test sent anything to a real cloud AI. The browser tests ran in Firefox and Chromium on the Mac. These checks need the Windows PC, Windows Firefox, your own Bonsai 2 (`start_bonsai.bat`), and a real API key.

## What the agent ran on 2 Nov 2026 (before the steps that need you)

- **`npm test`:** 1,245 passed and 5 failed. All 5 were Windows-only test issues, fixed the same day (1,249 pass now). None was a bug in the app: three left a folder behind in TEMP after killing a fake AI server; one tested a lock with chmod, which doesn't hold one on Windows; one checked the macOS-and-Linux behaviour of adopting a server from the pid file after a crash — on Windows the app never does that on purpose, so that test now runs only where it is true.
- **`npm run eval:parse` against your real Bonsai 2:** it started "AI: Bonsai 2 (llama-server)", so your settings load as one saved AI called Bonsai 2. It read the three sample ads in 7.1 seconds each (the goal is about 20 s), 24 of 27 fields right; ad 02's requirements took in the nice-to-haves. The temp key copy was gone after the run.
- **Key hygiene baseline:** `Select-String` finds no `sk-ant-` in `config\settings.json` or the logs (nothing to find yet — no key has been added).
- **Handover run 2 (the runbook, `docs/handover/runbook.md`):** every step PASS, no bugs. On your Bonsai 2 it read an ad in 10 s, rated "strong, 92", quick-marked a card in 2 s, wrote a resume in 43 s with a clean fact-check, and exported a .docx. One Windows bug in the checks themselves was found and fixed along the way (the test copy's settings are now written before `setup.bat` runs in it).
- What's left is the Firefox, Claude-key and pill work below, which needs you.

Before you start: copy `config\settings.json` somewhere safe. Have a Claude API key ready, from the Claude Console (platform.claude.com, with a little credit on it). A Claude Pro or Max login can't be used here. The checks below send only a few short requests to Claude, which cost a few cents at most.

## Your settings after the update

- **One saved AI, nothing lost:** open **Settings → AI**. **My AIs** has one AI, marked **In use**. It's "Bonsai 2" if your AI was Bonsai 2 (llama-server), or "My AI server" if it was "Another OpenAI-style server" (as after run 1). Open it: the address, the program or .bat file, and each task's Thinking, Longest answer, Temperature and Model are as they were before the update. (2 Nov: your settings load as one saved AI called "Bonsai 2" at http://127.0.0.1:8080/v1 — seen from the eval run; looking at the Settings page is still yours.)
- **"My AI server" needs a model to save:** if your AI is "My AI server" and its **Model** box is empty, **Save AI settings** says "Model: pick one from the list, or type its name." Open the Model list and pick the one your server lists (llama-server lists its model file), then save. Note what the list showed.
- **The file keeps its old shape until you save:** if you haven't saved any settings since the update, `config\settings.json` still has the old `"ai"` section (`"preset"` at the top of it, no `"saved"`). After you press **Save AI settings** once, it has `"active"` and `"saved"`, and any `"extra"` fields you had are still under each task. (2 Nov: it still has the old shape, as expected before a first save.)
- **Ratings come once more:** open a job page you rated before the update. It says "Rating…" and rates again, once. Open it again: the rating shows at once.
- **A new provider drops each task's own extras:** press **Duplicate** on your AI. On the copy, change **Provider** to Claude (Anthropic API). If any task had a model or `"extra"` fields of its own, the form says "Each task's own model and extra settings are reset for the new provider.", and each task's Model box empties. Press **Save AI settings**, then open `config\settings.json`: under the copy, every task has `"model": null` and `"extra": {}`; your own AI's tasks are as they were. Delete the copy.

## A real cloud AI (Claude)

- **Add it:** in Settings → AI, press **Add an AI** and pick **Claude (Anthropic API)** as the Provider. The name becomes "Claude". Change it to `Claude – mine` (copy the dash from this line, or type Alt+0150 on the number pad). Its note says what Claude sees and that each request is billed to the key. **Get a key** opens the Claude Console in a new tab.
- **The model list:** paste the key into **API key**, then open the **Model** list. Our suggestions come first, with their tags (claude-sonnet-5-5 "Best value" first), then the models Anthropic lists for your key. Note whether Anthropic's list appeared, or a sentence saying why not.
- **Test before saving:** press **Test connection**. It says "Connected to Claude (Anthropic API). It replied in … ms." Note the time. The AI pill still shows your old AI, and Claude isn't in the pill's menu yet.
- **A wrong key costs nothing:** type an `x` at the end of the key and press **Test connection**: "Claude – mine refused its API key. Check the key in Settings → AI." Delete the `x` again.
- **Save:** press **Save AI settings**. The toast says "Added Claude – mine." The form shows "✓ Key saved" with **Replace** and **Remove**, and the key itself is nowhere on the page.
- **The key stays on this PC:** in PowerShell, in the app folder, run
  ```
  Select-String -Path config\settings.json, data\logs\*.log -Pattern "sk-ant-" -SimpleMatch
  ```
  It prints nothing. `Select-String -Path config\secrets.json -Pattern "aiKeys"` prints one line. (2 Nov baseline: nothing found, as expected before a key exists.)
- **A refused key clears once you fix it:** on Claude – mine, press **Replace**, paste the key with an `x` at the end, and press **Save AI settings**. Switch to Claude – mine from the pill, and save a new ad (paste any ad with **New job**). The pill says "Claude – mine · problem", Settings → AI's "Right now" line says "Claude – mine refused its API key. …", and the job says "Couldn't read the ad yet. Claude – mine refused its API key. … It will be read the next time the AI works". (A refused key costs nothing.) Now **Replace** the key with the right one and save: the pill goes back to "ready" at once, and the "Right now" line no longer says refused. Press **Test connection**: the job is read within a few seconds. Switch back to Bonsai 2.
- **One rating on Claude:** click the AI pill, pick **Claude – mine**. The toast says "Now using Claude – mine.", and the pill says "Claude – mine · ready". Open one job page with the extension. Note how many seconds the rating takes, and whether its reasons make sense. Then switch back to Bonsai 2 from the pill. (Stay off search lists while Claude is in use: quick marks would rate every card, each one billed.)
- **The bill:** in the Claude Console's usage page, the requests from these checks show up. Note what they cost.
- **Optional, another provider:** if you have a key for another provider, add it the same way and press **Test connection** once. (Gemini's free tier and OpenRouter's free model cost nothing, but Google may use what you send on its free tier to improve its products.) Note the provider, the result and the time.

## Firefox and the API key field

The API key field is a password field marked as a new password (`autocomplete="new-password"`), like the Gmail app-password field. So Firefox may offer to save the key, or to suggest a password of its own.

- **After Save AI settings** with a key typed in, note whether Firefox offers to save a password for 127.0.0.1 (a key icon in the address bar, or "Save login for 127.0.0.1?"). If it asks, choose **Never save** (or **Not now**): the app already keeps the key.
- **Nothing filled in by itself:** press **Add an AI** and pick another cloud provider. The API key field is empty: Firefox doesn't fill in the Claude key or the Gmail app password. Note if it offers a generated password when you click in the field.
- **about:logins** has no entry for 127.0.0.1, unless you said yes.

## Two Bonsai 2 AIs on 127.0.0.1:8080

Your Bonsai 2 starts from `start_bonsai.bat` on port 8080. The app never closes a window it didn't start, so after a switch the old model may still be answering on that port.

- **What llama-server lists:** with Bonsai 2 running, run in PowerShell
  ```
  node -e "fetch('http://127.0.0.1:8080/v1/models').then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,1)))"
  ```
  Copy the whole output into the results. The app's model-file check reads only names that end in `.gguf` (any folder, any case). If every `"id"` is a short name with no `.gguf` (an alias, such as `"bonsai"`), the check can't tell two models apart. Write that down: then the "still running" sentence below never comes, and that's not a bug in this run. (2 Nov: it lists one model, whose id is the whole path, `D:\aitest\Bonsai-demo\models\bonsai2-gguf\27B\Ternary-Bonsai-2-27B-PQ2_0.gguf`. It ends in `.gguf`, so the check can tell two models apart, and the "still running" sentence below can happen. In **Model file**, type `Ternary-Bonsai-2-27B-PQ2_0.gguf`.)
- **Set up a second AI:** in My AIs, press **Duplicate** on Bonsai 2. Rename "Bonsai 2 (copy)" to `Bonsai test`. If you have a second model file and a second .bat file that starts it on port 8080, put that .bat file in **Program or .bat file**. Otherwise leave the program as it is. Leave **Model file** empty on both AIs, and press **Save AI settings**.
- **The warning at the switch:** with Bonsai 2's window open, switch to **Bonsai test** from the pill. The toast says "Now using Bonsai test. Bonsai 2 may still be running on 127.0.0.1:8080. Close its window if it is." No new window opens, because something already answers on port 8080. Switch back to Bonsai 2.
- **Switching while a resume is being written:** press **Generate resume** on a job. While the text is still coming, switch to Bonsai test from the pill. The pill shows Bonsai test at once. The draft keeps coming and finishes, or stops with the text so far kept. Note which. Switch back to Bonsai 2.
- **The "still running" sentence:** open Bonsai 2, and in **Model file** type the .gguf file your `start_bonsai.bat` runs (the name from the list above). Save. Open Bonsai test, and in **Model file** type another file (its real one, or `not-running.gguf` if you have only one model). Save. With Bonsai 2's window open, switch to Bonsai test. Within a few seconds the pill says "Bonsai test · problem", and the top line of its menu says "Bonsai 2 is still running on 127.0.0.1:8080. Close its window, then try again." Open a job page: its rating fails with the same sentence.
- **After you close the window:** close Bonsai 2's window, then open a job page. With a second .bat file, the app opens it (minimised), and the rating comes. With only one, the app opens `start_bonsai.bat` again, and the same sentence comes once it answers. Note what happened.
- **A switch opens the window at once:** close every Bonsai window, so nothing answers on port 8080. Switch to Bonsai 2 from the pill. Its .bat window opens straight away (minimised), and the pill goes "starting…", then "ready".
- **Clean up:** with Bonsai 2 in use, press **Delete** on Bonsai test and confirm. Keep Bonsai 2's **Model file** if the list above showed `.gguf` names.

## The AI pill and its menu in Windows Firefox

Do these in **Light** and in **Dark** (Settings → Display), and once with the Firefox window at half the screen's width.

- **The pill:** in the header band, it shows a dot, the AI's name and its state ("Bonsai 2 · ready"), and a small down arrow. A long name such as "Claude – mine" fits, and the dash in it, the · between the name and the state, the ✓ in the menu and the … in "Manage AIs…" all show as themselves, not as boxes.
- **The menu:** click the pill. It lists "On this computer" first, then "Cloud", each AI with its provider and model, a ✓ on the AI in use, and **Manage AIs…** last. It's easy to read in both themes, and nothing is cut off at half width.
- **By keyboard only:** press Tab until the pill has the focus ring. Enter opens the menu, with the focus on the AI in use. ↓ and ↑ move, Enter picks: the toast says "Now using …", and the focus is back on the pill. Esc closes the menu without a switch. Note anything that doesn't work this way.
- **A problem in the menu:** press **Duplicate** on Claude – mine. The copy has no key ("No API key yet" in My AIs, and under its name in the pill's menu). Switch to it from the pill: the toast says "Now using Claude – mine (copy). No API key yet: add one in Settings → AI." Open a job page Claude hasn't rated (the copy uses the same model, so Claude's saved ratings would come back without asking it). The pill says "Claude – mine (copy) · problem", and the menu's top line says "Claude – mine (copy) needs an API key. Add it in Settings → AI." Nothing was sent to Claude. Switch back to Bonsai 2, then delete the copy.

## Comparing AIs with eval:parse in PowerShell

- **A name with a dash:** in PowerShell (Windows PowerShell, then Windows Terminal if you use it), in the app folder, run
  ```
  npm run eval:parse -- --ai "Claude – mine"
  ```
  It starts with "AI: Claude – mine (anthropic) at https://api.anthropic.com/v1, model claude-sonnet-5-5" and reads the three sample ads (three short requests, billed to the key). If it says "There's no saved AI called …" instead, note how the name looks in that line, then run it with the id it lists, `--ai claude-mine`. Note which worked. (2 Nov: the run without `--ai` works in PowerShell — "AI: Bonsai 2 (llama-server) at http://127.0.0.1:8080/v1", the three sample ads at 7.1 s each. The dash test needs the saved Claude first.)
- **The key copy goes:** the run (with or without `--ai`) copies only the key of the AI it runs into a temporary folder. After it ends, `Get-ChildItem $env:TEMP -Directory -Filter jr-eval-*` prints nothing. Run it again and press Ctrl+C part-way, then check again: nothing. (2 Nov: after a full run the folder was gone. The script also cleans up on Ctrl+C and on closing the terminal; the Ctrl+C try is still yours.)

## The handover with a cloud AI in use

- If Claude is in use when the runbook runs, its steps 3, 6 and 7 print `SKIP the local AI checks - the AI in use is Claude ? mine, a cloud AI; these checks are for Bonsai 2` (the checks print plain ASCII, so the dash shows as `?`), and step 10 sends Claude one short test, billed to the key. To have the AI checks run, switch to Bonsai 2 first.
