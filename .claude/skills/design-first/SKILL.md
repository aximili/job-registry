---
name: design-first
description: Design a UI change before building it — screenshot what is there now, build two or three real options, show the user the screenshots, and build only the one they pick. Use for any change the user will see in the dashboard: a restyle, a colour or theme change, a layout change, a new component, card, form or control. Skip it for a pure bug fix or a copy-only change, where the look does not change.
---

# Design first

The user picks the design from real screenshots before the final build. A description of a design
is not a design: two people read "a bolder card" two different ways, and the user only finds out
which one I meant after the work is done.

**The options are built in the real app, not mocked up.** A mock-up uses different fonts, spacing
and data from the real app. So a mock-up that looks good proves nothing about the shipped page.

**If you cannot read images, say so at the start.** The user then does the two visual checks this
skill gives you — spotting a broken shot before choosing, and comparing "after" with "before". You
hand over every screenshot's path and still do everything else.

(Adapted from the skill of the same name in the sibling project nemity, 30 Oct 2026.)

---

## 0. Read the brief

- CLAUDE.md: plain English and Australian spelling in the UI, and the architecture rules.
- [docs/architecture.md](../../../docs/architecture.md) §10, Dashboard: what the page you're touching
  must show, and its keyboard rules.
- The design tokens: [web/src/app.css](../../../web/src/app.css). Its top comment is the brief. Use
  the tokens. Don't hard-code a hex value in a component. The extension's popup and panel keep their
  own colours (`extension/src/popup/Popup.svelte`, `extension/src/panel/Panel.svelte`).
- **Two themes.** The dashboard has a light and a dark theme. Shoot and judge every option in both.

If you have the `frontend-design` skill, load it and use its process and its list of AI-generated
defaults. Without it, the checks in step 2 are enough. **Either way, the brief wins.** Keep Atkinson
Hyperlegible: it's there so a page reads at a glance in the middle of a phone call. Propose a new
palette only when the request is about colour or contrast. Be bold through layout, scale and
hierarchy, not decoration.

## 1. Shoot "before"

There's no server to start. `shoot.ts` starts its own copy of the app on a free port, with a fresh
temporary data folder, a fake AI and a fake mailbox. It fills it with a small job hunt (eight jobs,
a call, notes, two follow-ups, a sent resume, two emails), and stops it when it ends. So it never
touches your real data, and never clashes with `npm start` (4777) or a `npm run test:e2e` run (4799).

It serves its own build, not `web/dist`, so a test run in progress keeps its build. Build first,
then shoot:

```bash
npm run build -- --outDir "<project>/temp/design-first/dist"
node .claude/skills/design-first/shoot.ts before --out temp/design-first
```

(`<project>` is the absolute path of this project: Vite reads a relative `--outDir` from `web/`.)

- Each run shoots eight pages (`home`, `search` (results for "engineer"), `job`, `board`, `settings`
  (the AI section), `display`, `inbox`, `editor`), in light and dark, at two widths: `desktop`
  (1440 × 900) and `half` (960 × 1000, a window snapped to half the screen, where layouts break
  first). That's 32 shots, named `<name>-<page>-<scheme>-<size>.png`.
- Narrow it with `--pages home,job`, `--scheme light|dark` and `--size desktop|half`.
- `--full` shoots the whole page, not just the window.
- `--selector '<css>'` shoots one element instead of the window. Give that run its own name
  (`before-card`), or it overwrites the window shots.
- It uses Firefox, the browser the user works in. If Firefox is missing, run
  `npx playwright install firefox` once.
- `temp/` is git-ignored.

**Look at every screenshot yourself** before showing it. A broken *shot* (blank, cut off, still
loading) gets re-shot; the app is not changed yet. If you cannot read images, list the paths for the
user instead, ask them which, if any, look broken, and wait for that answer.

## 2. Plan the options

Write two or three options. Each one has a one-line idea, an ASCII sketch, and one line on what it
gives up. **Make them differ in kind,** not in degree. "Same layout, blue or green" is one option.
A small change, such as a spacing fix, gets one option plus "before", and the user still picks
between the two. Don't make three versions of a two-line change.

Check each option before building it:

- **Does it look generic?** Change any part you would have produced for any app (use the
  `frontend-design` list of defaults if you have it).
- **Does it work mid-call?** The search box and the call sheet must read at a glance. The boldest
  thing on a page should be what you act on: the status, the next step, the one main button.
- **Is the contrast real?** Measure it, don't judge it by eye. Text needs 4.5:1 against what it sits
  on. The edges of fields and buttons need 3:1. Check both themes.
- **Is it simple?** An option that needs a new setting, a new API field or a migration is a bigger
  change than it looks. Say so in its trade-off line.
- **Asked to make something easier to notice?** Change its size, colour or icon. Don't add a card or
  a sentence around it: that is more to read for everyone, including people who already knew (the
  user's call in nemity, 5 Oct 2026).
- **Does it break a test?** The browser tests find things by role, label and heading
  (`tests/e2e/`). Don't rename one.

## 3. Build each option and show it

Build all the options in the real app, so that the default stays exactly as it was:

- **A theme or colour option:** put it in `web/src/app.css` under `:root[data-design='b']`, and
  shoot it with `--design b`. In a component, use `:global(html[data-design='b']) .row { … }`.
- **A component option:** use one temporary constant in the component.

```ts
// design-first: temporary, remove once an option is picked
const DESIGN_OPTION: 'a' | 'b' | 'c' = 'a';
```

Rebuild into `temp/design-first/dist` after each change (it takes about a second), then shoot each
option (`option-a`, `option-b`, …).

Show the user:

- Each option's screenshot paths, with its one-line idea and its trade-off.
- **Your recommendation, and why.**
- Then ask them to pick, or to mix parts of two options. If you have a question tool, give one
  option per design and put the description in the text, not a `preview` field (previews don't
  render). Otherwise ask in plain text.

**Stop here until they answer.** Don't build further.

## 4. Build the pick

- Delete the `data-design` blocks or the constant, and the options they didn't pick. Leave no dead
  branches.
- Add a test only if the pick adds logic, and see it fail before the change.
- Run `npm test`. If you changed markup, also run `npm run test:e2e`. It needs port 4799: if
  another run holds it, wait for that run to finish. Don't stop it.
- Shoot `after` (rebuild first). Compare it with `before` in both themes and at both widths: it must
  look at least as good on every part of the page, not just the part you changed. If you cannot read
  images, hand the user both sets of paths for that check. Then remove one thing that doesn't need
  to be there.
- If the change creates a rule on how the UI behaves, add it to docs/architecture.md §10.
- Show the user `before` and `after` side by side.
- **Don't stage or commit.**
