# Several AIs, switched in one click — design

**Date:** 31 Oct 2026. **Status:** draft, waiting for the user's OK. The builder check is done (four questions: three settled as my calls, one answered by the user).
**Phase:** 8 (asked for on 31 Oct 2026).

## Why

Today Settings → AI holds one AI. To use a different one, the user retypes the server, model and task settings each time. They want to keep several and switch in one click, the way KiloCode does with its configuration profiles. Their real cases:

- **A usage limit runs out.** They switch to another key with the same provider (their wife's), or to a local model.
- **The PC is busy.** When a heavy program is running, they pick a smaller local model, or the same model with lighter settings.
- **Trying models out.** They try different models to see which does the job best.

## What the user said

These points are theirs, from the conversation:

- When you add an AI, you pick its provider from a dropdown of presets. It lists the most popular choices: the best, the best value, and the best local ones. It includes Claude (only the ways that are allowed), Z.ai, Kimi, DeepSeek, Ollama and others.
- Once you give a key or settings, the AI is saved. Your saved AIs appear in a second list, "My AIs".
- Two saved AIs can use the same provider with different keys.
- They agreed to this playback: one AI in use for the whole app; switch from the header's AI pill or Settings → AI; switching between local models stops the one the app started and starts the other; a plain message when an AI hits its limit, with the switcher offered, and never a switch on its own; each cloud provider says what it can see.

## What we found (and told the user)

- **A Claude Pro or Max subscription can't be used.** Since early 2026, Anthropic's terms allow subscription logins only in Claude.ai and Claude Code. The API refuses them anywhere else. Claude works here with an API key from the Claude Console, billed per use.
- **The Z.ai GLM Coding Plan covers coding tools only.** Its address (`/api/coding/paas/v4`) and its keys are for Z.ai's supported tools. This app uses Z.ai's general API (`https://api.z.ai/api/paas/v4`) with a pay-per-use key.
- **Claude's OpenAI-style address ignores `response_format`.** The app relies on that field for JSON answers, so Claude gets its own connector that uses Anthropic's own Messages API.
- **The app can't send an API key today.** The OpenAI-style connector sends no `Authorization` header.

## Goals

1. Save any number of AIs. Each one has a name, a provider preset, an address, a key (for cloud ones), a model and its own task settings. That covers thinking, longest answer, temperature, a model per task, and the local program and its options.
2. Switch the AI in use in one click from any page, using the AI pill in the header.
3. Add an AI in a few steps. Pick a provider, and its address, key link and suggested models fill in. Give it a name, paste a key, pick a model and save.
4. **Duplicate** an AI. That makes "Bonsai 27B" into "Bonsai 2B light" or "Claude – wife's" quickly, without retyping the settings. A duplicate never copies the key.
5. Test any saved AI without switching to it. That way you can check your wife's key before you need it.
6. When an AI refuses a key, or says you're over your limit, say so in plain words and name the AI. Then point to the switcher.
7. An existing `settings.json` keeps working. It becomes one saved AI with all its settings, including the user's `start_bonsai.bat`.

## Non-goals

These are not in this piece of work. Each could come later.

- Subscription logins for Claude or Z.ai's Coding Plan. They aren't allowed (see above).
- A different AI for each task, such as Claude for writing while Bonsai rates. One AI does every task.
- Recording which AI made each rating or draft.
- Switching to another AI automatically when one fails or hits its limit.
- Usage meters or cost tracking.
- A switcher in the browser extension.
- Encrypting `secrets.json`. API keys get the same care as the Gmail app password today: a git-ignored file that never leaves the server.

## Anti-goals (a failure even if it works)

- **A key leaks.** No key may reach the browser, the extension, a log, an error message, `settings.json`, or a test copy of the settings. The only exception is the handover check that the user runs on purpose; see "Scripts".
- **The app switches AI, or uses a paid AI, without the user choosing it.**
- **The user's settings break.** Their `settings.json` stops loading, or loses a setting, after the upgrade.
- **A cloud AI is set up out of the box.** The default stays one saved AI: Bonsai 2 on this computer.
- **The wrong model runs silently.** For example, two local AIs share `127.0.0.1:8080` and the old one is still answering.

## Constraints

- The architecture rules in AGENTS.md and architecture.md §4 and §15 all hold. `jobs` never depends on `ai`. Outside systems sit behind ports. Every API body is a zod contract in `shared/contracts/`. Only `server/app.ts` wires things together. `npm run check:deps` passes.
- Erasable TypeScript only. There's no database change for this work: AIs live in `settings.json`, and keys live in `secrets.json`.
- Plain English and Australian spelling in the UI, docs, comments and errors.
- Any change the user will see goes through the design-first skill (see "UI").
- The Windows scripts stay ASCII with CRLF line endings, if any change.

## The design

### 1. Settings shape

The `ai` section changes from one AI to a list and a pointer. In the example below, the `…` parts hold today's fields.

```json
"ai": {
  "active": "bonsai-2",
  "saved": [
    {
      "id": "bonsai-2",
      "name": "Bonsai 2",
      "preset": "llama-server",
      "baseUrl": "http://127.0.0.1:8080/v1",
      "model": "",
      "timeoutSec": 300,
      "stopWhenIdle": false,
      "idleMinutes": 15,
      "managed": { "enabled": true, "exe": "…", "args": ["…"], "startTimeoutSec": 120 },
      "tasks": { "parse": {…}, "rate": {…}, "card": {…}, "write": {…}, "email": {…} }
    }
  ]
}
```

- **Each saved AI has every field today's `ai` section has, plus `id` and `name`.** So all the settings stay per AI, including the task settings and `managed`. A cloud AI just ignores `managed`, `stopWhenIdle` and `idleMinutes`.
- **`id`** is made from the name when the AI is added (lower case, a–z, 0–9 and `-`, made unique). It never changes, even when the AI is renamed, because the key is stored under it.
- **`active`** must name a saved AI, and there's always at least one. You can't delete the AI in use: switch first. And you can't delete the last one.
- **Defaults:** with no `ai` section, there's one saved AI, `bonsai-2` ("Bonsai 2"), with today's defaults.
- **Old files:** an `ai` section in today's flat shape is read as one saved AI. Its name is the preset's label, and its id is made from that name. A zod preprocess step does this, so old test fixtures and the handover's test settings keep loading. The file is rewritten in the new shape only on the next save, which is what happens today.
- **Unknown keys are still refused** (strict objects), as today.
- **Code that reads the AI's settings** (the provider, both runtimes and every task) gets the AI in use, through one helper in `shared/contracts/` (for example `activeAi(settings.ai)`). The task code keeps its current shape. The type and helper names are the builder's call.

### 2. Keys

- `secrets.json` gains `aiKeys: { "<ai id>": "<key>" }`.
- `GET /settings/secrets` says *which* AIs have a key, never the key itself. A form shows "Key saved" with **Replace** and **Remove**, as the Gmail password does today.
- Saving, replacing or removing a key is dashboard-only, as the email password is.
- Deleting an AI removes its key. Duplicating an AI never copies the key.
- Each key goes only to its own provider, from the server, in the header that provider expects.
- Error messages and logs never include a key. If a provider's error text echoes the key back, the app removes it before the text goes anywhere.

### 3. The provider catalogue

One file in `shared/` lists every preset. For each, it gives:

- the label and group (Cloud, or On this computer)
- the address
- whether it needs a key, and a link to where you get one
- whether it needs a model
- whether the app can start it (only Bonsai 2's llama-server)
- which connector it uses (OpenAI-style or Claude's own)
- how it asks for JSON and for thinking (below)
- a short note shown when you add it (the privacy and cost note for cloud ones, "pay per use, not your Coding Plan" for Z.ai)
- suggested models, each with a short tag: "Best", "Best value", "Fast", "Free tier" or "Small, for a busy PC"

**The presets.** The builder checks each one against the provider's own docs at build time: its address, its JSON and thinking options, and its current models. They write the date they checked at the top of the file.

| Group | Preset | Notes |
|---|---|---|
| Cloud | Claude (Anthropic API) | Claude's own connector (§4). API key from the Claude Console. Not a Pro or Max login. |
| Cloud | OpenAI | |
| Cloud | Google Gemini | Through Google's OpenAI-style address. |
| Cloud | DeepSeek | Among the cheapest strong models. |
| Cloud | Kimi (Moonshot) | |
| Cloud | Z.ai (GLM) | The general API, not the Coding Plan address. |
| Cloud | Qwen (Alibaba Cloud) | The international address. |
| Cloud | Mistral | |
| Cloud | xAI (Grok) | |
| Cloud | Groq | Very fast open models. |
| Cloud | OpenRouter | One key for hundreds of models. Good for trying models out. |
| On this computer | Bonsai 2 (llama-server) | As today: the app can start it, and it can be a `.bat` file. |
| On this computer | Ollama | As today. |
| On this computer | LM Studio | As today. |
| On this computer | Another OpenAI-style server | As today (`custom`). Key optional. |

The four existing preset ids keep their names, so old files map across one to one.

**Model names change often.** The model field is a list fetched from the provider (`GET /models`, sent with the key) where the provider has one. The catalogue's suggestions go first, with their tags. You can always type a name instead. Fetching uses the key typed in the form, even before it's saved. That request is dashboard-only and stores nothing.

### 4. Connectors (the `AiProvider` port)

The port itself doesn't change. What changes is behind it.

- **The OpenAI-style connector learns each provider's dialect:**
  - It sends `Authorization: Bearer <key>` when the AI has a key.
  - It asks for JSON as the provider allows: a JSON schema where supported, otherwise `json_object` with the schema written into the system message as text. Zod checks every answer either way, with the one retry it has today (architecture §12.2).
  - It sends thinking the way that provider expects. The llama-server fields (`reasoning_effort: "none"` and `"xhigh"`, and `thinking_budget_tokens`) go only to the local presets. A cloud provider never gets a field it would refuse.
  - The builder decides how to describe a dialect in the catalogue. Each preset gets a test that shows the request body it sends.
- **A new Claude connector** speaks Anthropic's Messages API: chat, streaming and model listing. It uses Anthropic's structured outputs for JSON, and maps the four thinking levels onto Claude's thinking settings. It also marks the fixed start of each prompt for prompt caching. The prompts already put the profile first (architecture §12.1), which cuts the cost of repeat ratings. The builder loads the `claude-api` skill before writing it. It uses plain `fetch` like the other connector, unless the builder finds a strong reason for Anthropic's SDK. A new dependency means updating architecture §4.2.
- **Plain errors that name the AI**, for example:
  - 401 or 403: "Claude – mine refused its API key. Check the key in Settings → AI."
  - 429, or a quota or billing error: "Claude – mine says you've reached your usage limit. Switch to another AI from the AI pill at the top."
  - Can't reach the server: as today, naming the AI and its address.
- **A rate limit or refused key isn't retried** and doesn't start the AI program. It shows in the pill as "AI problem", with the sentence as its detail.

### 5. Switching

- **Where:** the AI pill in the header and Settings → AI. The pill is on every page.
- **What happens:**
  - The change saves at once, with no Save button. A short message confirms it ("Now using Claude – mine").
  - A task already running finishes on the old AI where it can. If it can't (say the old program is being stopped), it fails the way it does today, and a draft keeps the text written so far.
  - Tasks waiting in the queue, and every task after, use the new AI.
- **Local programs:** a llama-server the app started for the old AI is stopped, as it is today when the runtime changes. The builder may wait until the running task ends.
- **The new local AI starts at once** *(my call: the user agreed "starts the other")*. Switching to a local AI the app can start starts it straight away, and opens a `.bat` window if that's its program. A switch is something you did, so this is fine. It's not like background work, which never opens a window. The pill shows "AI starting…". Switching again cancels a start in progress, as a stop does today.
- **Two local AIs on one address** *(my call)*. The switch always goes through, because it's your choice. Then the app makes sure the right model is answering:
  - **The app knows which model file a local AI should run** when it has one. For a program, that's the `-m` option. For a `.bat` file, it's an optional "Model file" field, which now shows for Bonsai 2 too.
  - **When it knows the file,** it compares that with the model llama-server reports. It checks when the server already answers before a task, and when you press Test connection. If they differ, the task fails with a sentence that names both AIs: "Bonsai 27B is still running on 127.0.0.1:8080. Close its window, then try again." The pill shows it as "AI problem". So the wrong model never runs silently.
  - **When it doesn't know the file,** it warns once, at the switch, if the old AI uses the same address: "Bonsai 27B may still be running on 127.0.0.1:8080. Close its window if it is."
- **The pill shows which AI is in use**, as well as its state. The exact look is a design-first pick.

### 5a. Ratings after a switch (the user's pick)

**Each model keeps its own ratings.** After you switch to a different model, it rates a job or card again the first time you see it. If you switch to another key with the same model (your wife's), or back to a model you used before, its saved ratings come back.

- **How:** the ratings cache keys (`server/modules/ratings/service.ts`) are made from the ad or card and the profile hash. They gain the identity of the model that does the rating. There's no database change, because the key stays a string. The `ratings` module already depends on `ai`. A small method on the AI service gives the identity.
- **Model identity:** the provider preset plus the model the task actually uses. That's the task's own model if it has one (`tasks.rate.model` or `tasks.card.model`), otherwise the AI's model. For a local llama-server, it's the model file (§5); if the file isn't known, it's the AI's id. The task settings don't count (thinking, temperature), so "Bonsai 27B" and "Bonsai 27B lighter" share ratings when they run the same file. The exact form is the builder's call.
- A quick mark that reuses a full rating (Phase 7) looks it up with the rating task's model identity.
- **After the upgrade,** older ratings have no model in their key, so each job is rated once more the first time you see it. On Bonsai 2 that costs nothing but time. *(My call: no migration.)*
- This isn't the non-goal "recording which AI made each rating". Nothing new shows on screen.

### 6. UI

These are the requirements. The look and the layout are picked by the user from real screenshots, using the design-first skill. The builder makes two or three options of each of these two parts:

- **The switcher in the header.** It shows the AI in use and its state. One click opens the list of saved AIs: name, provider and model, and a mark on the one in use. Picking one switches. A last line, "Manage AIs…", opens Settings → AI. It works by keyboard: Enter or Space opens it, the arrow keys move, and Escape closes it and returns the focus. When there's an AI problem, its sentence shows in the list's header, so the way out sits right beside the problem.
- **Settings → AI.**
  - A "My AIs" list (name, provider · model, "In use" or **Use this**, Duplicate, Delete) and an **Add an AI** button.
  - Adding: the provider dropdown, grouped as Cloud and On this computer, then the form for that preset. Editing an AI opens the same form.
  - The form holds the name, address, key (for cloud ones: a password field, a "Get a key" link, and Replace and Remove once saved), model (the fetched list plus typing), the local program fields as today, and "How the AI works on each task" as today.
  - **Test connection** tests the AI shown in the form, whether or not it's in use. *(My call:)* it **never saves**, which changes today's behaviour. It tests the values in the form, with the key you typed, or the saved one if you didn't type one. So you can test "Claude – wife's" before you save it.
    - For the AI in use, the test waits in the queue as today, and may start its program using the saved program settings.
    - For any other AI, it runs at once and never starts or stops a program. If it's a local one that isn't running, the test says so.
    - It needs its own dashboard-only endpoint that takes a whole AI and an optional typed key.
  - Saving stays explicit, as today.
  - A cloud preset shows its note: "Claude sees your profile, the ads you save and rate, and (if email is on) your emails. Each request is billed to this key. Quick marks rate every card on a search page, so they use the most."
  - The "Right now" line and the side menu's "Problem" mark stay.

The browser tests find things by role, label and heading. Keep the names they use, or update the tests in the same task.

### 7. Scripts and handover

- **`npm run eval:parse`** uses the AI in use. A new `-- --ai "<name or id>"` picks another saved AI, for comparing models. Its temporary copy gets that AI's key, and the copy is deleted at the end, as today.
- **The handover checks** (`scripts/handover/`) follow the AI in use. If that's a cloud AI, the local AI checks report a SKIP with a plain reason ("the AI in use is Claude – mine, a cloud AI; these checks are for Bonsai 2"). They never copy a key into a test folder. The runbook and `tests/handover.test.ts` change to match.
- **`config/settings.example.json`** moves to the new shape. Its test (`tests/settings-example.test.ts`) keeps it valid.

### 8. Docs

All in the same piece of work:

- **architecture.md:** §1 (the Private goal: a cloud AI only when you add one, with its note), §4.1 and §6.1 (the dialects and the Claude connector; replace the "later, optional AnthropicProvider" row), §6.2, §7.6 if the states change, §9 (the new endpoints), §10 (the switcher, Settings → AI), §12 (the settings per AI, structured output per provider), §13 (keys), §16 (how to add a provider preset), §17 (risks: providers change their APIs and models; cloud costs), and §4.2 if a dependency is added.
- **A new decision record, `docs/decisions/0011-several-ais-and-cloud-providers.md`.** Add a line to 0004 that points to it, because 0004 says every server supports `json_schema`.
- **README:** the AI section covers saved AIs, keys, the presets, privacy and cost, and why subscriptions can't be used.
- **AGENTS.md:** the current status gets a Phase 8 entry. Also update `docs/plan.md`'s status.

## Testing

- **TDD throughout,** with a failing test first. Unit tests cover:
  - the settings migration (old flat file to the new shape, with nothing lost)
  - the rules on `active` and deleting
  - id generation
  - that keys never reach any response, log or error
  - each preset's request body
  - the Claude connector, against a fake Messages API
  - error wording for 401 and 429
  - switching (runtime stop, queue behaviour, the new local AI starting at once)
  - the model-file check when two local AIs share an address
  - ratings keyed by model: a different model rates again, the same model reuses
  - eval:parse `--ai`
- **Browser tests** (Firefox and Chromium): add an AI from a preset, test it before saving, duplicate it, switch from the pill by mouse and by keyboard, test an AI that isn't in use, and remove a key. Use fake servers only. No real cloud call runs in any test.
- `npm test` and `npm run test:e2e` pass.
- A real-provider check is optional, and only with a key the user gives. It isn't part of the build.

## Calls I made (check these)

- **The old AI on the same address** (§5): the switch always goes through. When the app knows which model file the AI should run, it checks the file, and a mismatch stops each task with a plain sentence. Otherwise it gives one warning at the switch.
- **A local AI starts at once** when you switch to it (§5), and opens its `.bat` window if it has one.
- **Test connection never saves** (§6). It tests what's in the form, so you can test a new AI before you save it.
- **Ratings after the upgrade** (§5a): each job is rated once more, with no migration.
- **Duplicate never copies the key** (Goals).
- **The handover's AI checks are skipped when a cloud AI is in use** (§7). They never copy a key.
- **The pill and Settings → AI each get two or three design options**, and you pick from screenshots (§6).

## Left to the builder

- Type, helper and endpoint names. Whether switching has its own endpoint or goes through `PATCH /settings`, as long as it's dashboard-only.
- How a dialect is described in the catalogue.
- How far to batch the work into plan tasks, and the order of tasks.
- Whether a running task blocks stopping the old llama-server, or is cancelled by it (with today's "text so far is kept" message).
- Each preset's exact models and tags, from the provider's docs at build time.
