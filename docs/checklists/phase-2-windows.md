# Phase 2: Windows checklist (the local AI)

The AI was built and tested on macOS with a fake AI server. These steps check what only your PC can: the real Bonsai 2 model on your RTX 3090, the download, starting and stopping llama-server, and switching to Ollama. Tick each one.

Before you start: stop the app with `stop.bat`, then run `setup.bat` to update.

## Getting the AI

- [ ] **`setup.bat` offers the download** at the end: "Download the AI now (Bonsai 2, about 8 GB)?". Answer y. (Or say no, and run `download-ai.bat` later.)
- [ ] **The download finishes** with "The AI is ready." and creates `ai\llama.cpp\llama-server.exe` and `ai\models\Ternary-Bonsai-2-27B-PQ2_0.gguf`.
- [ ] **Resuming:** start `download-ai.bat`, close the window halfway through the model, then run it again. It carries on, and doesn't start from zero.
- [ ] **Running it again** once everything is there only checks the files (no download, no unpacking) and says "The AI is ready." again.
- [ ] **While the app runs:** with the app open, run `download-ai.bat` on a fresh `ai` folder. It downloads, then says to run stop.bat and run it again to unpack. Doing that unpacks without downloading again.

## First start after updating

- [ ] **Your old jobs get read:** start the app. Jobs saved in Phase 1 show "Reading the ad…" and then fill in, one at a time. Fields you typed yourself don't change.
- [ ] **Without the AI:** if you skipped the download, every old job says "Couldn't read the ad yet." with the reason. None says "Reading the ad…" for ever.
- [ ] **A new job goes first:** while that's happening, paste a new ad. It's read before the remaining old ones.

## Bonsai 2 (the default)

- [ ] **Test connection:** Settings → AI → **Test connection**. The first time can take up to a minute while the model loads. It says "Connected to Bonsai 2 … It replied in … ms." The header pill shows **AI ready**.
- [ ] **Phase 2's goal:** paste a real Seek ad into **New job**, leave Role and Company empty, and save. Within about **20 seconds** the role, company, salary and key requirements fill in.
- [ ] **The pill** shows **AI working…** while it reads, then **AI ready**.
- [ ] **llama-server's window:** there's no extra console window for it. Its log is `data\logs\llama.log`, and it names your RTX 3090 (a CUDA device).
- [ ] **GPU memory comes back:** after 15 minutes with nothing to do, the pill says **AI off**, and `nvidia-smi` (or Task Manager → Performance → GPU) shows the memory freed.
- [ ] **`stop.bat` stops it too:** with the pill on **AI ready**, run `stop.bat`. In Task Manager → Details, there's no `llama-server.exe` left.
- [ ] **Closing the server window stops it too:** start the app, read an ad, then close the "Job Registry server" window. No `llama-server.exe` is left.
- [ ] **A llama-server you started yourself is left alone:** start `ai\llama.cpp\llama-server.exe -m ai\models\Ternary-Bonsai-2-27B-PQ2_0.gguf -ngl 99 --port 8080` in a terminal, then use the app and stop it. Your llama-server keeps running.

## When the AI isn't there

- [ ] **Not installed:** rename the `ai` folder, start the app, and paste an ad. The job saves at once and says "Couldn't read the ad yet. The AI program isn't installed …". The pill says **AI problem**. Rename the folder back and press **Read again**: it fills in.

## Ollama (optional, if you use it)

- [ ] **Switching by settings only:** start Ollama with a model you have (for example `ollama run qwen3:8b`). In Settings → AI pick **Ollama**, type the model name in **Model**, save, and press **Test connection**. It connects. Paste an ad: it's read by Ollama.
- [ ] **No model typed:** clear **Model** and press **Test connection**. It says "Pick a model. The server has: …" with your models.
- [ ] **A very long ad on LM Studio (optional):** LM Studio's default context is small. A very long ad may be refused: that job says so ("answered with an error (400)…"), and the other jobs are still read.
- [ ] **Switch back** to Bonsai 2 when you're done.

## Match ratings (once you have a master profile)

- [ ] Put your master profile in `profile\master-profile.md` (Phase 4 adds an editor; until then use any text editor). Settings → AI says "Ratings use profile/master-profile.md." Save a job: a **Match** box appears with a verdict, a score, and reasons for and against.

## How well it reads real ads

- [ ] Add 8–10 real ads to `tests\fixtures\ads\` with the fields filled in by hand (see the README in that folder). Run `npm run eval:parse` and keep the report. It shows what Bonsai 2 gets right, field by field, and the average time per ad.

Write down anything that doesn't match, and bring it to the next session.
