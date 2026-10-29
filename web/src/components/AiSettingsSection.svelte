<script lang="ts">
  // Settings → AI: which AI server to use, a button to check it answers, and
  // how the AI works on each task. Saving sends the whole AI section, so
  // settings that aren't on this page (such as each task's extra request
  // fields, which you can edit in settings.json) are kept.
  import { onMount } from 'svelte';
  import { AI_PRESETS, opensWindow, type AiPresetId, type AiSettings } from '../../../shared/contracts/index.ts';
  import { AI_LABEL, ai } from '../lib/ai-state.svelte.ts';
  import { fromRow, rowOf, rowProblem, TASK_ROWS, THINKING, type TaskKey, type TaskRow } from '../lib/ai-tasks.ts';
  import { api } from '../lib/api.ts';
  import { app, loadSettings } from '../lib/app-state.svelte.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  type Form = {
    preset: AiPresetId;
    baseUrl: string;
    model: string;
    managed: boolean;
    exe: string;
    args: string;
    stopWhenIdle: boolean;
    idleMinutes: number | null;
    tasks: Record<TaskKey, TaskRow>;
  };

  const PRESETS = Object.entries(AI_PRESETS) as [AiPresetId, (typeof AI_PRESETS)[AiPresetId]][];

  // True while the form has changes you haven't saved, for the Settings menu.
  let { dirty = $bindable(false) }: { dirty?: boolean } = $props();

  let base: AiSettings | null = null;
  let saved = $state('');
  let form = $state<Form>({
    preset: 'llama-server',
    baseUrl: '',
    model: '',
    managed: true,
    exe: '',
    args: '',
    stopWhenIdle: false,
    idleMinutes: 15,
    tasks: rowsOf(app.settings.ai.tasks),
  });
  let ready = $state(false);
  let busy = $state(false);
  let testing = $state(false);
  let result = $state<{ ok: boolean; text: string } | null>(null);
  let error = $state<string | null>(null);
  let ratings = $state('');

  function rowsOf(tasks: AiSettings['tasks']): Record<TaskKey, TaskRow> {
    return {
      parse: rowOf(tasks.parse),
      rate: rowOf(tasks.rate),
      card: rowOf(tasks.card),
      write: rowOf(tasks.write),
      email: rowOf(tasks.email),
    };
  }

  function take(ai: AiSettings) {
    base = ai;
    form = {
      preset: ai.preset,
      baseUrl: ai.baseUrl,
      model: ai.model,
      managed: ai.managed.enabled,
      exe: ai.managed.exe,
      args: ai.managed.args.join('\n'),
      stopWhenIdle: ai.stopWhenIdle,
      idleMinutes: ai.idleMinutes,
      tasks: rowsOf(ai.tasks),
    };
    saved = JSON.stringify(form);
  }

  const managedHere = $derived(form.preset === 'llama-server' && form.managed);
  const batch = $derived(opensWindow(form.exe));
  // The idle minutes box is on screen only in this case.
  const idleShown = $derived(managedHere && !batch && form.stopWhenIdle);

  $effect(() => {
    dirty = ready && JSON.stringify(form) !== saved;
  });

  onMount(() => {
    take(app.settings.ai);
    ready = true;
    api
      .ratingsStatus()
      .then((s) => (ratings = s.detail))
      .catch(() => (ratings = ''));
  });

  function pickPreset() {
    const preset = AI_PRESETS[form.preset];
    if (preset.baseUrl) form.baseUrl = preset.baseUrl;
    form.managed = preset.managed;
  }

  // The form checks its own numbers (novalidate), so a problem shows as a
  // sentence beside the buttons, not as the browser's bubble. Throws that
  // sentence, and nothing is saved.
  function fromForm(): AiSettings {
    const ai = base!;
    // A box you can't see can't block a save: it keeps the saved minutes.
    let idle = ai.idleMinutes;
    if (idleShown) {
      const typed = form.idleMinutes;
      if (typeof typed !== 'number' || !Number.isInteger(typed) || typed < 1) {
        throw new Error('Stop it after this many idle minutes: use a whole number, 1 or more.');
      }
      idle = typed;
    }
    const tasks = { ...ai.tasks };
    for (const { key, label } of TASK_ROWS) {
      const problem = rowProblem(label, form.tasks[key]);
      if (problem) throw new Error(problem);
      tasks[key] = fromRow(ai.tasks[key], form.tasks[key]);
    }
    return {
      ...ai,
      preset: form.preset,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      stopWhenIdle: form.stopWhenIdle,
      idleMinutes: idle,
      managed: {
        ...ai.managed,
        enabled: form.managed,
        exe: form.exe.trim(),
        args: form.args
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean),
      },
      tasks,
    };
  }

  async function persist(): Promise<void> {
    const next = await api.updateSettings({ ai: fromForm() });
    await loadSettings();
    take(next.ai);
  }

  async function save() {
    busy = true;
    error = null;
    try {
      await persist();
      showToast('AI settings saved.');
    } catch (err) {
      error = friendlyError(err);
    } finally {
      busy = false;
    }
  }

  // Tests what's on screen: unsaved changes are saved first.
  async function test() {
    testing = true;
    error = null;
    result = null;
    try {
      if (JSON.stringify(form) !== saved) await persist();
      const res = await api.testAi();
      result = { ok: res.ok, text: res.detail };
    } catch (err) {
      result = { ok: false, text: friendlyError(err) };
    } finally {
      testing = false;
    }
  }
</script>

<section id="ai" aria-labelledby="ai-heading">
  <h2 id="ai-heading" tabindex="-1">AI</h2>
  {#if ai.known}
    <p class="now" class:bad={ai.state === 'error'}>Right now: {AI_LABEL[ai.state]}.{ai.detail ? ` ${ai.detail}` : ''}</p>
  {/if}
  <p class="muted intro">
    The AI reads the ads you save and rates how well each one fits you. It runs on this computer. Pick the server it talks
    to, then press Test connection.
  </p>
  {#if ready}
    <form
      class="ai-form"
      novalidate
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label class="field wide">
        <span>AI server</span>
        <select bind:value={form.preset} onchange={pickPreset}>
          {#each PRESETS as [id, preset] (id)}<option value={id}>{preset.label}</option>{/each}
        </select>
      </label>
      <label class="field wide"><span>Server address</span><input bind:value={form.baseUrl} spellcheck="false" /></label>
      {#if AI_PRESETS[form.preset].needsModel}
        <label class="field">
          <span>Model</span>
          <input bind:value={form.model} spellcheck="false" aria-describedby="model-hint" />
        </label>
        <p id="model-hint" class="muted hint">The name the server knows it by, for example qwen3:8b.</p>
      {/if}
      {#if form.preset === 'llama-server'}
        <div class="wide check-row">
          <label class="check"><input type="checkbox" bind:checked={form.managed} /> Start it for me when it isn't running</label>
          <p class="muted hint">If it's already running, the app uses it as it is and never stops it.</p>
        </div>
        {#if managedHere}
          <div class="wide start" role="group" aria-label="How the app starts it">
            <label class="field">
              <span>Program or .bat file</span>
              <input bind:value={form.exe} spellcheck="false" aria-describedby="exe-hint" />
            </label>
            <p id="exe-hint" class="muted hint">
              llama-server.exe, or a .bat file that starts it, such as your own start_bonsai.bat.
            </p>
            {#if batch}
              <p class="note">
                The app opens this file in its own window, minimised, when it needs the AI for you and the AI isn't running: when
                you save an ad, press Test connection, or open a job page or a search list. Checking Gmail waits instead. The app
                never closes that window: close it yourself when you want the AI to stop.
              </p>
            {:else}
              <label class="field">
                <span>Options (one per line)</span>
                <textarea bind:value={form.args} rows="6" spellcheck="false" aria-describedby="args-hint"></textarea>
              </label>
              <p id="args-hint" class="muted hint">
                What llama-server starts with: the model file, the graphics card, the context size and the port.
                download-ai.bat sets these up for the app's own Bonsai 2.
              </p>
              <label class="check">
                <input type="checkbox" bind:checked={form.stopWhenIdle} aria-describedby="idle-hint" /> Stop it when it's idle
              </label>
              {#if idleShown}
                <label class="field idle">
                  <span>Stop it after this many idle minutes</span>
                  <input type="number" min="1" bind:value={form.idleMinutes} />
                </label>
              {/if}
              <p id="idle-hint" class="muted hint">
                {#if form.stopWhenIdle}
                  This frees the graphics card's memory for other programs. It starts again when it's next needed, and it always
                  stops when Job Registry stops.
                {:else}
                  It keeps running until Job Registry stops.
                {/if}
              </p>
            {/if}
          </div>
        {:else}
          <p class="wide muted hint">Start it yourself before you use the AI. The app never starts or stops it.</p>
        {/if}
      {:else}
        <p class="wide muted hint">Start this server yourself. The app only sends it work, and never starts or stops it.</p>
      {/if}
      <div class="wide tasks">
        <h3>How the AI works on each task</h3>
        <p class="muted hint">
          Thinking gives better answers but takes longer. Keep quick marks light, and let resume writing think hard. Longest
          answer is in tokens: a token is about three-quarters of a word. Leave Model empty to use the same model as above.
        </p>
        {#each TASK_ROWS as row (row.key)}
          <fieldset class="task">
            <legend>{row.label}</legend>
            <label class="field">
              <span>Thinking <span class="visually-hidden">for {row.label}</span></span>
              <select bind:value={form.tasks[row.key].thinking}>
                {#each THINKING as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
              </select>
            </label>
            <label class="field">
              <span>Longest answer (tokens) <span class="visually-hidden">for {row.label}</span></span>
              <input type="number" min="16" step="1" bind:value={form.tasks[row.key].maxTokens} />
            </label>
            <label class="field">
              <span>Temperature <span class="visually-hidden">for {row.label}</span></span>
              <input type="number" min="0" max="2" step="0.1" bind:value={form.tasks[row.key].temperature} />
            </label>
            <label class="field">
              <span>Model <span class="visually-hidden">for {row.label}</span></span>
              <input bind:value={form.tasks[row.key].model} placeholder="Same as above" spellcheck="false" />
            </label>
          </fieldset>
        {/each}
      </div>
      {#if error}<p class="error wide" role="alert">{error}</p>{/if}
      <div class="actions wide">
        <button type="submit" class="button primary" disabled={busy || testing}>Save AI settings</button>
        <button type="button" class="button" disabled={busy || testing} onclick={test}>{testing ? 'Testing…' : 'Test connection'}</button>
      </div>
      {#if testing || result}
        <p class="wide result" class:bad={result && !result.ok} role="status">{result?.text ?? 'Testing…'}</p>
      {/if}
    </form>
    {#if ratings}<p class="muted">{ratings}</p>{/if}
  {/if}
</section>

<style>
  .now {
    font-weight: 600;
  }

  .now.bad {
    color: var(--danger);
  }

  .ai-form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
    max-width: 44rem;
  }

  .wide {
    grid-column: 1 / -1;
  }

  .hint {
    font-size: var(--step--1);
    align-self: end;
    margin: 0;
  }

  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    font-weight: 600;
  }

  .check-row {
    display: grid;
    gap: var(--space-1);
  }

  /* The fields that only count when the app starts it, set in under the tick box. */
  .start {
    display: grid;
    gap: var(--space-2);
    padding-left: var(--space-4);
    border-left: 2px solid var(--rule);
    margin-left: 0.45rem;
  }

  .start .hint {
    margin-bottom: var(--space-2);
  }

  .idle input {
    max-width: 8rem;
  }

  .note {
    max-width: 65ch;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    background: var(--accent-soft);
  }

  textarea {
    width: 100%;
    font-family: var(--mono, ui-monospace, monospace);
  }

  .tasks {
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

  .tasks h3 {
    font-size: var(--step-0);
  }

  /* One task: its four settings side by side, wrapping on a narrow screen. */
  .task {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
    gap: var(--space-2) var(--space-3);
    align-items: end;
    margin: 0;
    padding: var(--space-2) var(--space-3) var(--space-3);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
  }

  .task legend {
    padding: 0 var(--space-1);
    font-weight: 600;
  }

  .task input,
  .task select {
    width: 100%;
    min-width: 0;
  }

  .actions {
    display: flex;
    gap: var(--space-3);
  }

  .result {
    margin: 0;
    min-height: 1.4em;
  }

  .result.bad {
    color: var(--danger);
  }
</style>
