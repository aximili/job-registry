<script lang="ts">
  // The form for one AI, saved or new: its provider, name, address, API key,
  // model, the program the app starts (Bonsai 2) and how it works on each
  // task. Test connection tries what's on screen, with the key you typed (or
  // the saved one), and saves nothing. Save AI settings saves the AI section,
  // then the key, if you typed one. Settings that aren't on this form (such
  // as each task's extra request fields) are kept as they are, unless the
  // provider changes: then each task's own model and extra fields go, as
  // they were for the old provider.
  import { onMount, tick } from 'svelte';
  import {
    AI_PRESETS,
    newAiId,
    newSavedAi,
    opensWindow,
    THINKING_TOKENS,
    type AiModelsResult,
    type AiPresetId,
    type SavedAi,
  } from '../../../shared/contracts/index.ts';
  import { defaultAiName, presetGroups } from '../lib/ai-list.ts';
  import {
    forNewProvider,
    fromRow,
    hasOwnTaskSettings,
    longestOff,
    rowOf,
    rowProblem,
    TASK_ROWS,
    THINKING,
    type TaskKey,
    type TaskRow,
  } from '../lib/ai-tasks.ts';
  import { api } from '../lib/api.ts';
  import { app, loadSettings } from '../lib/app-state.svelte.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import ModelPicker from './ModelPicker.svelte';

  type Form = {
    preset: AiPresetId | '';
    name: string;
    baseUrl: string;
    model: string;
    managed: boolean;
    exe: string;
    args: string;
    stopWhenIdle: boolean;
    idleMinutes: number | null;
    tasks: Record<TaskKey, TaskRow>;
  };

  let {
    base,
    keySaved = false,
    dirty = $bindable(false),
    onsaved,
    oncancel,
    onkeys,
  }: {
    // The AI as saved, or null for a new one.
    base: SavedAi | null;
    // Whether this AI has an API key saved.
    keySaved?: boolean;
    // True while the form has changes you haven't saved, for the Settings menu.
    dirty?: boolean;
    onsaved: (ai: SavedAi, added: boolean) => void;
    oncancel: () => void;
    // The ids of the AIs with a key, after a key changed.
    onkeys: (ids: string[]) => void;
  } = $props();

  const tokens = (n: number) => n.toLocaleString('en-AU');

  function rowsOf(tasks: SavedAi['tasks']): Record<TaskKey, TaskRow> {
    return {
      parse: rowOf(tasks.parse),
      rate: rowOf(tasks.rate),
      card: rowOf(tasks.card),
      write: rowOf(tasks.write),
      email: rowOf(tasks.email),
    };
  }

  function formOf(ai: SavedAi): Form {
    return {
      preset: ai.preset,
      name: ai.name,
      baseUrl: ai.baseUrl,
      model: ai.model,
      managed: ai.managed.enabled,
      exe: ai.managed.exe,
      args: ai.managed.args.join('\n'),
      stopWhenIdle: ai.stopWhenIdle,
      idleMinutes: ai.idleMinutes,
      tasks: rowsOf(ai.tasks),
    };
  }

  // The AI as saved; for a new one, the defaults of the provider you picked.
  let draft = $state.raw<SavedAi | null>(null);
  let isNew = $state(false);
  let saved = $state('');
  let form = $state<Form>(formOf(newSavedAi('llama-server', 'New AI', [])));
  let nameTouched = false;
  let ready = $state(false);
  let busy = $state(false);
  let testing = $state(false);
  // A test's result, and what was on screen when it ran.
  let result = $state<{ ok: boolean; text: string; for: string } | null>(null);
  let error = $state<string | null>(null);

  let key = $state('');
  let replacing = $state(false);
  let keyBusy = $state(false);
  let keyInput = $state<HTMLInputElement>();
  let replaceButton = $state<HTMLButtonElement>();
  let presetSelect = $state<HTMLSelectElement>();

  function take(ai: SavedAi | null) {
    draft = ai;
    form = ai ? formOf(ai) : { ...formOf(newSavedAi('llama-server', '', [])), preset: '', name: '' };
    saved = JSON.stringify(form);
    key = '';
    replacing = false;
  }

  onMount(() => {
    isNew = base === null;
    take(base);
    ready = true;
  });

  const kind = $derived(form.preset ? AI_PRESETS[form.preset] : null);
  const managedHere = $derived(form.preset === 'llama-server' && form.managed);
  const batch = $derived(opensWindow(form.exe));
  // The idle minutes box is on screen only in this case.
  const idleShown = $derived(managedHere && !batch && form.stopWhenIdle);
  // Bonsai 2's Model file: for your own .bat file, or a server you start yourself.
  const modelFileShown = $derived(form.preset === 'llama-server' && (!form.managed || batch));
  const takesKey = $derived(kind !== null && kind.key !== 'none');
  // A saved AI whose provider you've changed on screen.
  const presetMoved = $derived(!isNew && draft !== null && form.preset !== draft.preset);
  // A saved key belongs to the provider it was saved for: it never goes to another.
  const keyMoved = $derived(presetMoved && keySaved);
  // Each task's own model and extra fields were for the old provider: they go.
  const tasksReset = $derived(presetMoved && draft !== null && hasOwnTaskSettings(draft.tasks));
  const showSavedKey = $derived(takesKey && keySaved && !keyMoved && !replacing);
  // A key typed into the field and not saved yet.
  const typedKey = $derived(takesKey && !showSavedKey ? key.trim() : '');
  // What a test depends on. A result shows only while these are as they were.
  const testSource = $derived(JSON.stringify([form.preset, form.baseUrl.trim(), typedKey, form.model.trim()]));
  const shownResult = $derived(result && result.for === testSource ? result : null);

  $effect(() => {
    dirty = ready && ((isNew && form.preset !== '') || JSON.stringify(form) !== saved || typedKey !== '');
  });

  // A new provider brings its own address and first suggested model. A new
  // AI also takes the provider's name, until you type one. Each task's own
  // model was for the old provider, so its box empties; back on a saved AI's
  // own provider, it shows the saved one again.
  function pickPreset() {
    if (!form.preset) return;
    const preset = form.preset;
    const next = AI_PRESETS[preset];
    if (isNew) {
      const names = app.settings.ai.saved.map((one) => one.name);
      if (!nameTouched) form.name = defaultAiName(preset, names);
      draft = newSavedAi(
        preset,
        form.name,
        app.settings.ai.saved.map((one) => one.id),
      );
    }
    if (next.baseUrl) form.baseUrl = next.baseUrl;
    else if (isNew) form.baseUrl = '';
    form.managed = next.managed;
    form.model = next.needsModel ? (next.models[0]?.id ?? '') : '';
    const own = !isNew && draft !== null && preset === draft.preset;
    for (const { key: task } of TASK_ROWS) form.tasks[task].model = own ? (draft!.tasks[task].model ?? '') : '';
  }

  // The form checks its own values (novalidate), so a problem shows as a
  // sentence beside the buttons, not as the browser's bubble. Throws that
  // sentence. forSave also refuses a name another AI has.
  function fromForm(forSave: boolean): SavedAi {
    const ai = draft!;
    const name = form.name.trim();
    if (!name) throw new Error('Give this AI a name.');
    if (name.length > 60) throw new Error('Keep the name to 60 characters or fewer.');
    const others = app.settings.ai.saved.filter((one) => isNew || one.id !== ai.id);
    if (forSave && others.some((one) => one.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new Error(`You already have an AI called ${name}. Pick another name.`);
    }
    const baseUrl = form.baseUrl.trim();
    if (!/^https?:\/\/\S+$/i.test(baseUrl) || !URL.canParse(baseUrl)) {
      throw new Error('Server address: type the whole address, starting with http:// or https://.');
    }
    // Without one, every task would ask for a model called "default". A test
    // may go without: the server then says which models it has.
    if (forSave && AI_PRESETS[form.preset as AiPresetId].needsModel && !form.model.trim()) {
      throw new Error('Model: pick one from the list, or type its name.');
    }
    // A box you can't see can't block a save: it keeps the saved minutes.
    let idle = ai.idleMinutes;
    if (idleShown) {
      const typed = form.idleMinutes;
      if (typeof typed !== 'number' || !Number.isInteger(typed) || typed < 1) {
        throw new Error('Stop it after this many idle minutes: use a whole number, 1 or more.');
      }
      idle = typed;
    }
    // A new provider: each task's extra fields (and its own model, which the
    // box already shows as gone) were for the old one.
    const moved = !isNew && form.preset !== ai.preset;
    const tasks = { ...ai.tasks };
    for (const { key: task, label } of TASK_ROWS) {
      const problem = rowProblem(label, form.tasks[task]);
      if (problem) throw new Error(problem);
      tasks[task] = fromRow(moved ? forNewProvider(ai.tasks[task]) : ai.tasks[task], form.tasks[task]);
    }
    return {
      ...ai,
      // A new AI's id is made from its name when it's first saved, and never changes.
      id: isNew
        ? newAiId(
            name,
            app.settings.ai.saved.map((one) => one.id),
          )
        : ai.id,
      name,
      preset: form.preset as AiPresetId,
      baseUrl,
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

  async function save() {
    busy = true;
    error = null;
    try {
      const typed = typedKey;
      // Start from the settings as saved now, so nothing done elsewhere is
      // lost, and a name or id another tab has just taken is caught here.
      await loadSettings();
      const edited = fromForm(true);
      const all = app.settings.ai;
      if (!isNew && !all.saved.some((one) => one.id === edited.id)) {
        throw new Error("This AI isn't saved any more. Add it again with Add an AI.");
      }
      const list = isNew ? [...all.saved, edited] : all.saved.map((one) => (one.id === edited.id ? edited : one));
      // A new provider never gets the old one's key: the server deletes it.
      await api.updateSettings({ ai: { active: all.active, saved: list } });
      // A key can only be saved for an AI that's saved, so it comes second.
      let keyProblem: string | null = null;
      if (typed) {
        try {
          onkeys((await api.updateSecrets({ aiKeys: { [edited.id]: typed } })).aiKeys);
        } catch (err) {
          keyProblem = `The AI is saved, but its key isn't: ${friendlyError(err)}`;
        }
      }
      // Which AIs have a key now, after any the server deleted.
      if (!typed || keyProblem) {
        await api
          .secretsStatus()
          .then((status) => onkeys(status.aiKeys))
          .catch(() => undefined);
      }
      await loadSettings();
      const fresh = app.settings.ai.saved.find((one) => one.id === edited.id) ?? edited;
      if (!isNew) take(fresh);
      onsaved(fresh, isNew);
      if (keyProblem) {
        if (isNew) showToast(keyProblem);
        else error = keyProblem;
      }
    } catch (err) {
      error = friendlyError(err);
    } finally {
      busy = false;
    }
  }

  // Tests what's on screen. Nothing is saved. The AI pill changes only when
  // this is the AI in use exactly as saved, with its saved key.
  async function test() {
    testing = true;
    error = null;
    result = null;
    const asked = testSource;
    try {
      const ai = fromForm(false);
      const res = await api.checkAi({ ai, ...(typedKey ? { key: typedKey } : {}) });
      result = { ok: res.ok, text: res.detail, for: asked };
    } catch (err) {
      result = { ok: false, text: friendlyError(err), for: asked };
    } finally {
      testing = false;
    }
  }

  // The model list, for the AI as it is on screen. A form that isn't ready
  // to test yet (no name, say) still lists models.
  async function loadModels(): Promise<AiModelsResult> {
    const baseUrl = form.baseUrl.trim();
    if (!URL.canParse(baseUrl)) return { ok: false, models: [], detail: 'Type the server address first.' };
    const ai: SavedAi = { ...draft!, name: form.name.trim() || 'New AI', preset: form.preset as AiPresetId, baseUrl, model: form.model.trim() };
    return api.aiModels({ ai, ...(typedKey ? { key: typedKey } : {}) });
  }
  const modelSource = $derived(`${form.preset}|${form.baseUrl.trim()}|${typedKey || (showSavedKey ? 'saved' : '')}`);

  async function removeKey() {
    if (!draft) return;
    keyBusy = true;
    error = null;
    try {
      onkeys((await api.updateSecrets({ aiKeys: { [draft.id]: null } })).aiKeys);
      showToast('API key removed.');
      // A disabled button can't take the focus.
      keyBusy = false;
      await tick();
      keyInput?.focus();
    } catch (err) {
      error = friendlyError(err);
    } finally {
      keyBusy = false;
    }
  }

  async function replace() {
    replacing = true;
    await tick();
    keyInput?.focus();
  }

  async function keep() {
    replacing = false;
    key = '';
    await tick();
    replaceButton?.focus();
  }

  // For the section: where the cursor goes when this form opens.
  export function focusStart() {
    if (isNew) presetSelect?.focus();
    else document.getElementById('ai-form-heading')?.focus();
  }

  export function focusName() {
    (document.getElementById('ai-name') as HTMLInputElement | null)?.select();
  }
</script>

<form
  class="ai-form"
  aria-labelledby="ai-form-heading"
  novalidate
  onsubmit={(e) => {
    e.preventDefault();
    void save();
  }}
>
  <h3 id="ai-form-heading" class="wide" tabindex="-1">{isNew ? 'Add an AI' : (draft?.name ?? '')}</h3>

  <label class="field">
    <span>Provider</span>
    <select bind:value={form.preset} onchange={pickPreset} bind:this={presetSelect}>
      {#if form.preset === ''}<option value="" disabled>Pick one</option>{/if}
      {#each presetGroups() as group (group.label)}
        <optgroup label={group.label}>
          {#each group.ids as id (id)}<option value={id}>{AI_PRESETS[id].label}</option>{/each}
        </optgroup>
      {/each}
    </select>
  </label>

  {#if kind}
    <label class="field">
      <span>Name</span>
      <input id="ai-name" bind:value={form.name} oninput={() => (nameTouched = true)} maxlength="60" autocomplete="off" />
    </label>
    {#if kind.note}<p class="note wide">{kind.note}</p>{/if}
    <label class="field wide"><span>Server address</span><input bind:value={form.baseUrl} spellcheck="false" /></label>

    {#if keyMoved && draft}
      <p class="note wide">The key saved for {AI_PRESETS[draft.preset].label} is removed when you save.</p>
    {/if}
    {#if tasksReset}
      <p class="note wide">Each task's own model and extra settings are reset for the new provider.</p>
    {/if}
    {#if takesKey}
      <div class="key wide">
        {#if showSavedKey}
          <span class="key-label">API key</span>
          <p class="key-saved"><span class="tick" aria-hidden="true">✓</span> Key saved</p>
          <button type="button" class="button" disabled={keyBusy} onclick={replace} bind:this={replaceButton}>Replace</button>
          <button type="button" class="button quiet" disabled={keyBusy} onclick={removeKey}>Remove</button>
        {:else}
          <label class="field key-field">
            <span>{kind.key === 'optional' ? 'API key (if it needs one)' : 'API key'}</span>
            <input
              type="password"
              bind:value={key}
              bind:this={keyInput}
              autocomplete="new-password"
              spellcheck="false"
              aria-describedby="key-hint"
            />
          </label>
          {#if kind.keyUrl}
            <a class="get-key" href={kind.keyUrl} target="_blank" rel="noreferrer">
              Get a key<span class="visually-hidden"> (opens a new tab)</span>
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M5 2.5H2.5v7h7V7M7 2.5h2.5V5M9.5 2.5 5.5 6.5" /></svg>
            </a>
          {/if}
          {#if replacing}<button type="button" class="button quiet" onclick={keep}>Cancel</button>{/if}
          <p id="key-hint" class="muted hint key-hint">It's kept on this computer when you save, and never shown again.</p>
        {/if}
      </div>
    {/if}

    {#if kind.needsModel}
      <div class="model">
        <ModelPicker
          bind:value={form.model}
          label="Model"
          id="ai-model"
          describedby="model-hint"
          provider={kind.label}
          suggestions={kind.models}
          canList={kind.dialect.listModels}
          source={modelSource}
          load={loadModels}
        />
      </div>
      <p id="model-hint" class="muted hint">
        {#if kind.group === 'cloud'}
          Pick one from the list, or type any model's name.
        {:else}
          The name the server knows it by, for example qwen3:8b.
        {/if}
      </p>
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
      {#if modelFileShown}
        <div class="wide model-file">
          <ModelPicker
            bind:value={form.model}
            label="Model file"
            id="ai-model-file"
            describedby="model-file-hint"
            placeholder="Optional"
            provider="the server"
            suggestions={kind.models}
            canList={kind.dialect.listModels}
            source={modelSource}
            load={loadModels}
          />
          <p id="model-file-hint" class="muted hint">
            The .gguf file it runs. With it, the app can tell when another model is answering at this address.
          </p>
        </div>
      {/if}
    {:else if kind.group === 'local'}
      <p class="wide muted hint">Start this server yourself. The app only sends it work, and never starts or stops it.</p>
    {/if}

    <div class="wide tasks">
      <h4>How the AI works on each task</h4>
      <p class="muted hint">
        Thinking gives better answers but takes longer, so keep quick marks light. Low, Medium and High let the AI think for
        up to {tokens(THINKING_TOKENS.low)}, {tokens(THINKING_TOKENS.medium)} and {tokens(THINKING_TOKENS.high)} tokens, on top
        of the longest answer. No limit leaves both to the AI: Bonsai 2 then thinks as long as it likes. A token is about
        three-quarters of a word. Leave Model empty to use the same model as above.
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
            <input type="number" min="16" step="1" bind:value={form.tasks[row.key].maxTokens} disabled={longestOff(form.tasks[row.key])} />
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
  {:else}
    <p class="muted hint pick">Pick where the AI runs: in the cloud with an API key, or on this computer.</p>
  {/if}

  {#if error}<p class="error wide" role="alert">{error}</p>{/if}
  <div class="actions wide">
    {#if kind}
      <button type="submit" class="button primary" disabled={busy || testing}>Save AI settings</button>
      <button type="button" class="button" disabled={busy || testing} onclick={test}>{testing ? 'Testing…' : 'Test connection'}</button>
    {/if}
    {#if isNew}<button type="button" class="button quiet" disabled={busy} onclick={oncancel}>Cancel</button>{/if}
  </div>
  {#if testing || shownResult}
    <p class="wide result" class:bad={shownResult && !shownResult.ok} role="status">{shownResult?.text ?? 'Testing…'}</p>
  {/if}
</form>

<style>
  .ai-form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
    max-width: 44rem;
  }

  .wide {
    grid-column: 1 / -1;
  }

  h3 {
    font-size: var(--step-1);
  }

  select,
  .field input {
    min-width: 0;
  }

  .hint {
    font-size: var(--step--1);
    align-self: end;
    margin: 0;
  }

  .pick {
    align-self: center;
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

  .key {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-2) var(--space-3);
  }

  .key-field {
    flex: 1 1 18rem;
  }

  .key-field input {
    width: 100%;
  }

  .key-hint {
    flex-basis: 100%;
  }

  .key-label {
    flex-basis: 100%;
    font-size: var(--step--1);
    font-weight: 600;
    color: var(--ink-2);
  }

  .key-saved {
    align-self: center;
    margin: 0 var(--space-2) 0 0;
    font-weight: 700;
  }

  .tick {
    color: var(--ok);
  }

  .get-key {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) 0;
    font-weight: 600;
    color: var(--accent);
  }

  .get-key svg {
    width: 0.8em;
    height: 0.8em;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .model-file {
    display: grid;
    gap: var(--space-1);
    max-width: 30rem;
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

  .tasks h4 {
    margin: 0;
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
    flex-wrap: wrap;
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
