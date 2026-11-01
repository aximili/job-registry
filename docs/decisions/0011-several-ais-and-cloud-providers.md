# 0011 — Several saved AIs, and cloud providers behind the same port

**Status:** Accepted (1 Nov 2026). Built in Phase 8 (31 Oct – 1 Nov 2026). It extends [0004](0004-openai-compatible-ai.md).

## Context
- Settings → AI held one AI. To use another, you retyped its server, model and task settings each time. You want to keep several and switch in one click:
  - **A usage limit runs out.** Switch to another key with the same provider, or to a local model.
  - **The PC is busy.** Pick a smaller local model, or the same one with lighter settings.
  - **Trying models out,** to see which does the job best.
- You also want cloud providers: Claude, Z.ai, Kimi, DeepSeek and others.
- 0004 assumed every server speaks the OpenAI-style API in the same way. Cloud providers don't:
  - **Keys:** most want `Authorization: Bearer`, Claude wants `x-api-key`. The app sent no key at all.
  - **JSON:** DeepSeek, Z.ai and Qwen take only `json_object`, not a JSON schema. Claude's OpenAI-style address ignores `response_format` altogether.
  - **Thinking:** each has its own fields, and many current models can't turn thinking off.
  - **Small things:** the name of the token-limit field, whether a temperature is refused, and whether there's a model list.
  - **Errors:** "out of credit" comes as 402, 429, 400 or even 403, depending on the provider.
- **Subscriptions:** Anthropic's terms allow a Claude Pro or Max login only in Claude's own apps and Claude Code. Z.ai's GLM Coding Plan "may only be used within officially supported tools". API keys, billed per use, are fine for both.

## Decision
- **Saved AIs.** `settings.json`'s `ai` section is `{ active, saved }`. Each saved AI has every field the one-AI section had (the task settings and Bonsai 2's program included), plus an `id` and a `name`. One AI is in use for the whole app. The default is still one AI, Bonsai 2, so no cloud AI is set up out of the box.
- **Old files keep working.** A one-AI section is read as one saved AI (named Bonsai 2, Ollama, LM Studio or My AI server, after its preset), and the file takes the new shape at the next save.
- **Keys** live in `secrets.json` under `aiKeys`, by AI id. They never reach the browser, the extension, a log, an error message or the handover's test copy. Each goes only to its own provider, and it's deleted with its AI or when that AI's provider changes. The one exception is on purpose: `npm run eval:parse` (with or without `--ai`) copies the key of the AI it runs (the one `--ai` names, or else the AI in use) into its temporary copy, and deletes it at the end (also on Ctrl+C or a closed window; only a forced kill leaves it).
- **A catalogue of 15 presets** (`shared/contracts/ai-presets.ts`): 11 cloud and 4 on this computer. Each gives an address, a key page, suggested models with tags, a note, and a **dialect**: which connector, how to ask for JSON, the thinking fields for each level, the token-limit field, whether to send a temperature, and whether there's a model list.
- **Two connectors behind the same `AiProvider` port.** The OpenAI-style one learns the dialects and sends keys. A new Claude connector speaks Anthropic's own Messages API: Claude's structured outputs for JSON, adaptive thinking with an effort, and prompt caching on the system message. Both use plain `fetch`, with no SDK.
- **"Off" on a cloud AI** asks for the least thinking the provider takes, because many current models refuse to stop thinking. It gets Medium's room (2,048 tokens) on top of the longest answer, so that little thinking can't cut a short answer such as a quick mark.
- **Plain errors that name the AI:** a refused key, a usage limit, no key yet, or busy. None is retried, and the app never switches AI by itself. The sentence points to the switcher.
- **Switching** from the header's AI pill or Settings → AI, saved at once. A task already running finishes on the old AI, and waiting tasks run on the new one. A llama-server the app started for the old AI stops, and one the app starts for the new AI starts at once.
- **The right local model:** when two Bonsai 2 AIs share an address, the app checks the model file the server reports against the one the AI should run, and stops the task with a sentence when they differ.
- **Ratings per model** (your pick): the rating cache's key gains the model's identity. A different model rates again, and a model used before finds its own ratings.
- **Test any AI without saving or switching** (`POST /ai/check`), with the key you typed.

## Other options considered
- **Claude through its OpenAI-style address.** One connector fewer, but it ignores `response_format`, which every task relies on for JSON.
- **Anthropic's SDK, and its newest API version (2026-10-21), for the Claude connector.** Typed and complete, but a new dependency, and that version refuses any temperature at all. The connector sends only a few fields, so plain `fetch` with version 2023-06-01 is enough. A later version bump is a one-line change.
- **A Claude Pro or Max login, or Z.ai's Coding Plan.** Not allowed by their terms.
- **A different AI for each task** (say, Claude writes while Bonsai 2 rates). More flexible, but more to set up and to understand. Left for later.
- **Switching to another AI by itself** when one fails or hits its limit. It could start spending money without asking, or send your data somewhere you didn't choose.
- **Keeping one set of ratings across a switch, or clearing them.** You chose ratings per model, so a better model's ratings are its own, and switching back costs nothing.
- **Encrypting `secrets.json`.** The app would need the key to unlock it on the same PC, so it adds little. Keys get the same care as the Gmail app password.

## Consequences
- Switching takes one click, and an existing `settings.json` keeps working.
- **Not every server supports `json_schema` now.** DeepSeek, Z.ai and Qwen get `json_object`, with the schema written into the system message, and Claude gets its own structured outputs. zod checks every answer either way, with one retry.
- A cloud AI sees your profile, the ads you save and rate, and (if email is on) your emails, and each request is billed to its key. That happens only after you add one and switch to it, and its note says so where you add it.
- Providers change their APIs, models and prices often. The catalogue is dated (`PRESETS_CHECKED`) and marks each fact that couldn't be confirmed. The model list is fetched live, any model name can be typed, and a task's `extra` can change any request field.
- After a switch to another model, each job and card is rated again the first time you see it. After the upgrade, every job is rated once more.
- The handover's local AI checks print SKIP when a cloud AI is in use, because the handover's test copy never gets a key.
- A new provider that speaks the OpenAI-style API is one catalogue entry. One that doesn't needs a connector too.
