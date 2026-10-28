<script lang="ts">
  // Settings → AI: which AI server to use, and a button to check it answers.
  // Saving sends the whole AI section, so settings that aren't on this page
  // (such as the per-task ones you can edit in settings.json) are kept.
  import { onMount } from 'svelte';
  import { AI_PRESETS, type AiPresetId, type AiSettings } from '../../../shared/contracts/index.ts';
  import { AI_LABEL, ai } from '../lib/ai-state.svelte.ts';
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
    idleMinutes: number;
  };

  const PRESETS = Object.entries(AI_PRESETS) as [AiPresetId, (typeof AI_PRESETS)[AiPresetId]][];

  let base: AiSettings | null = null;
  let saved = '';
  let form = $state<Form>({ preset: 'llama-server', baseUrl: '', model: '', managed: true, exe: '', args: '', idleMinutes: 15 });
  let ready = $state(false);
  let busy = $state(false);
  let testing = $state(false);
  let result = $state<{ ok: boolean; text: string } | null>(null);
  let error = $state<string | null>(null);
  let ratings = $state('');

  function take(ai: AiSettings) {
    base = ai;
    form = {
      preset: ai.preset,
      baseUrl: ai.baseUrl,
      model: ai.model,
      managed: ai.managed.enabled,
      exe: ai.managed.exe,
      args: ai.managed.args.join('\n'),
      idleMinutes: ai.idleMinutes,
    };
    saved = JSON.stringify(form);
  }

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

  function fromForm(): AiSettings {
    const ai = base!;
    return {
      ...ai,
      preset: form.preset,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      idleMinutes: Number(form.idleMinutes),
      managed: {
        ...ai.managed,
        enabled: form.managed,
        exe: form.exe.trim(),
        args: form.args
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean),
      },
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
      <label class="field">
        <span>Model</span>
        <input bind:value={form.model} spellcheck="false" aria-describedby="model-hint" />
      </label>
      <p id="model-hint" class="muted hint">Needed for Ollama, LM Studio and custom servers, for example qwen3:8b.</p>
      {#if form.preset === 'llama-server'}
        <label class="check wide"><input type="checkbox" bind:checked={form.managed} /> Start and stop llama-server for me</label>
        {#if form.managed}
          <label class="field wide"><span>Program</span><input bind:value={form.exe} spellcheck="false" /></label>
          <label class="field wide">
            <span>Arguments (one per line)</span>
            <textarea bind:value={form.args} rows="6" spellcheck="false"></textarea>
          </label>
        {/if}
      {/if}
      <label class="field">
        <span>Stop the AI after this many idle minutes</span>
        <input type="number" min="1" bind:value={form.idleMinutes} />
      </label>
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

  h2:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
  }

  textarea {
    width: 100%;
    font-family: var(--mono, ui-monospace, monospace);
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
