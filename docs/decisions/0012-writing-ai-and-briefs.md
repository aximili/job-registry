# 0012 — A writing AI, a brief you check, and a budget for Bonsai 2's window

**Status:** Accepted (3 Nov 2026). Built in Phase 9 (3–4 Nov 2026). It extends [0011](0011-several-ais-and-cloud-providers.md).

## Context
- On 3 Nov 2026 you compared two cover letters for the same ad: one the app wrote on Bonsai 2, and one Claude Opus wrote in a chat. The Opus letter was much stronger, for three reasons:
  - **Missing facts.** Opus asked you questions first. The app couldn't, and its guide said "You can't ask me questions here."
  - **A dropped fact.** Seek shows the contact as "••••@example.com.au". Only the `mailto:` link holds the address, and the extension kept only the text on screen.
  - **Weak choices.** Bonsai matched the ad's skills list and used vague names. Opus answered what the ad values, with one short story each, and opened with the ad's most telling line.
- Since Phase 8 the whole app uses one AI at a time. To write with Claude, you'd switch everything to Claude, so quick marks would rate every card on a search page at Claude's prices.
- Bonsai 2 has a window of 32,768 tokens. Your master profile is about 86,000 characters (about 21,000 tokens), so a writing request with the guide and the ad could fill the window and leave no room to think.
- Getting ready for an interview is the next step after the letter, and needs the same inputs: your profile, the job, its ad and your notes.

## Decision
- **One writing AI.** `ai.writer` names one saved AI, or `null` for the AI in use (the default, so nothing changes until you pick one). It does the four writing tasks: resumes, cover letters, the brief and the prep plan. Reading ads, ratings, quick marks and emails stay on the AI in use. You pick it in Settings → AI or beside any write button, and it saves at once. The app never picks one by itself.
- **A writer that isn't saved** (a hand edit) falls back to the AI in use, and the screen says so. A save that deletes the writer sets it to `null`, so a later AI with the same id never writes by accident.
- **Its problems stay where you write.** When the writer isn't the AI in use, its errors come back in the stream, never on the pill, and their advice points to the writer.
- **A local writer that isn't the AI in use is never started or stopped.** It's used if it answers.
- **Lanes.** A cloud writer that isn't the AI in use gets a queue of its own, one task at a time, so a long Claude draft never waits behind Bonsai 2's ratings, or holds them up. A local writer shares the main queue, because there's one GPU. "Latest wins" holds across lanes: a keyed task cancels the same key in every queue (`cancelKey`), with a `ReplacedError`, so a reply still being read says a newer one took its place.
- **A brief you check before the AI writes.** One JSON task makes it from your profile, the job, its ad, its notes and your earlier answers. It holds who to write to, the ad's 2 or 3 biggest needs (each with the best story from your profile, and up to 2 others to swap in), the ad's most telling line (checked against the ad), your gaps with your nearest real evidence, and up to 5 questions whose answers would change the document. You fix it in a click or two, and every change saves at once. A new brief is shown for checking, never written from straight away. Your answers carry on into each new brief (10 questions at most), and "Add to my profile" adds each ticked answer to your master profile once, under its own heading, with a copy of the old file kept first.
- **A prep plan** ("Get ready"), made the same way: what to learn in a day, a practice project, likely interview questions with the story to tell, questions to ask them, and what to refresh. No links, and nothing about the employer the ad doesn't say.
- **Saved with the job,** in a new module, `prep`, which owns two tables, `briefs` and `prep_plans`. A new brief or plan is a new row, and the old ones stay.
- **The job's notes** go to every writing task, every note counted, the email reader's too. A note that sums up an email is true about the job, but not a fact about you or your wishes.
- **A budget for Bonsai 2's window** (`server/modules/ai/budget.ts`):
  - The app counts 4 characters a token (measured at 4.08 on your profile), so a request may hold 108,000 characters (27,000 tokens), leaving about 5,700 to think and answer.
  - Fixed caps: notes 1,200 characters in all, an answer 240, earlier answers 2,000, the brief as the writer gets it 4,500, the job's details 2,000, the ad 12,000 as before.
  - On a local AI, the ad gets what's left, never less than 2,000. A cloud AI gets the plain caps only.
  - The brief block gives each part a share (contact 200, opening 450, needs 1,600, gaps 750, answers 1,500). A part over its share cuts each item evenly, so every answer you typed reaches the writer.
  - Up to 120,000 characters, a request is sent anyway. Over that, it's refused at once, where you write, with a sentence that says what to shorten or to pick a cloud AI to write. A cloud AI is never refused.
  - Measured on your real profile with every cap full: brief 105,570 characters, prep plan 106,769 (both with all 12,000 of the ad), cover letter with a brief 108,000 (ad about 4,650), resume with a brief 108,000 (ad about 2,550, above the 2,000 floor).
- **The AI's answers are cut, never refused.** Each list and text is cut to its cap, and a short list is taken as it is. A refused answer would cost a second try, which a cloud AI bills.
- **One shared system part** for the four writing prompts (the rules and your profile), so llama-server's cache and Claude's prompt caching reuse about 21,000 tokens of profile from the brief to the letter to the plan.
- **A better cover-letter guide that reaches your Windows copy.** At start-up, a guide that is exactly an earlier starter (Windows line endings and the final line break don't count), and whose current starter you haven't seen, is updated, with its old text kept in `profile/old-versions/`. A guide you changed is left alone, and Settings → Profile offers the new one with a diff, **Use the new guide** and **Keep mine**.
- **Dashboard-only.** Every new route that uses the writing AI or changes your profile is dashboard-only, and so is writing a draft now. No installed extension can start a paid task.

## Other options considered
- **A writer per document kind** (one AI for resumes, another for letters). More to set up and understand, for little gain: the strong AI should do all the writing. One writer covers all four tasks.
- **Starting a second local program for a local writer.** Two models would fight for one GPU, and a second window could pop up when you didn't expect it. A local writer that isn't the AI in use is used only if it answers.
- **No brief: just better prompts.** The missing facts were the biggest cause, and only you have them. A brief also lets you see the plan, swap a story or drop a need before minutes of writing.
- **Writing straight on from a new brief.** Faster by one click, but checking the brief is the point.
- **Refusing a long answer.** A small model sometimes writes one more item or a longer line than asked. Cutting keeps the answer; refusing it costs a retry, and on a cloud AI a second bill.
- **Refusing every request over 108,000 characters.** Most requests just over still work, with a little less room to think. Sending up to 120,000 and refusing only above it fails fast where it would surely fail.
- **A separate, smaller thinking budget for writing on Bonsai 2.** You picked No limit in Phase 7. A full request leaves about 5,700 tokens, enough for a letter and tight for a long resume; the real fix is a cloud writer, or Writing's thinking at Medium.
- **Replacing every guide with the new starter.** It would overwrite guides you changed. Only an untouched earlier starter is updated, and its old text is kept.

## Consequences
- Bonsai 2 can rate everything for free while Claude writes your letters. The writer's name sits beside every write button, so you always know who writes, and who bills.
- A cloud writer sees your profile, your guide, and the job you write for (its ad, notes and brief). Each brief, plan and draft is billed to its key.
- Writing a letter is now usually two steps: make the brief and check it, then write. "Skip, just write" keeps the old one-step way.
- The profile can grow with your answers. Each added answer changes the profile's hash, so each job is rated once more.
- Writing on Bonsai 2 with the real profile is best effort: the letter fits, a long resume is tight. The Windows checklist times a brief, a plan and a letter on the 27B.
- When a starter guide changes, its old version's hash must be added to `STARTER_HISTORY`. A test checks the list against git.
