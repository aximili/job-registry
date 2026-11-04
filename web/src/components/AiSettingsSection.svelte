<script lang="ts">
  // Settings → AI: the AI that writes your documents, your saved AIs ("My
  // AIs"), which one is in use, and the form for one of them. The AI in use
  // opens first. Use this switches the whole app at once; the writing AI,
  // Duplicate and Delete save at once too. The form saves only when you
  // press Save AI settings.
  import { onMount, tick } from 'svelte';
  import { AI_PRESETS, type SavedAi } from '../../../shared/contracts/index.ts';
  import {
    deleteQuestion,
    duplicateAi,
    nameOf,
    removeAi,
    writerChoices,
    writerFallback,
    writerMessage,
    writerValue,
  } from '../lib/ai-list.ts';
  import { AI_LABEL, ai, aiKeys, switchAi } from '../lib/ai-state.svelte.ts';
  import { api } from '../lib/api.ts';
  import { app, loadSettings } from '../lib/app-state.svelte.ts';
  import { debounceLatest } from '../lib/debounce.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import AiForm from './AiForm.svelte';
  import AiList from './AiList.svelte';

  const NEW = 'new';

  // True while the form has changes you haven't saved, for the Settings menu.
  let { dirty = $bindable(false) }: { dirty?: boolean } = $props();

  // The AI open in the form: its id, or NEW for one you're adding.
  let editing = $state('');
  let keys = $state<string[]>([]);
  let formDirty = $state(false);
  let ready = $state(false);
  let busy = $state(false);
  let ratings = $state('');
  let formRef = $state<ReturnType<typeof AiForm>>();

  $effect(() => {
    dirty = formDirty;
  });

  // Which AIs have a key, here and for the AI pill, so a switch straight
  // after saving a key doesn't say it has none.
  function setKeys(ids: string[]) {
    keys = ids;
    aiKeys.ids = ids;
  }

  const all = $derived(app.settings.ai);
  const base = $derived(editing === NEW ? null : (all.saved.find((one) => one.id === editing) ?? null));

  // The AI that writes your documents: the id you picked, or '' for the AI in use.
  const writer = $derived(writerValue(all));
  const fallback = $derived(writerFallback(all));
  let writerSelect = $state<HTMLSelectElement>();

  // It saves on its own, 400 ms after the last change: on Windows an arrow
  // key moves a closed list, so arrowing through it saves once, the last pick.
  // Leaving the list, leaving Settings or closing the page saves at once.
  const saveWriter = debounceLatest(async (value: string) => {
    const id = value || null;
    try {
      app.settings = await api.useWriter(id);
      showToast(writerMessage(app.settings.ai, id));
    } catch (err) {
      showToast(friendlyError(err));
      // A refused pick shows what's saved again.
      if (writerSelect) writerSelect.value = writerValue(app.settings.ai);
    }
  }, 400);

  onMount(() => {
    editing = app.settings.ai.active;
    ready = true;
    const flush = () => saveWriter.flush();
    addEventListener('pagehide', flush);
    api
      .secretsStatus()
      .then((s) => setKeys(s.aiKeys))
      .catch((err: unknown) => showToast(friendlyError(err)));
    api
      .ratingsStatus()
      .then((s) => (ratings = s.detail))
      .catch(() => (ratings = ''));
    return () => {
      removeEventListener('pagehide', flush);
      flush();
    };
  });

  // Opening another AI would throw away what you typed, so it asks first.
  function mayLeave(): boolean {
    if (!formDirty) return true;
    const what = editing === NEW ? 'the new AI' : nameOf(all, editing);
    return confirm(`Your changes to ${what} aren't saved. Discard them?`);
  }

  async function open(id: string) {
    if (id !== editing) {
      if (!mayLeave()) return;
      editing = id;
      await tick();
    }
    formRef?.focusStart();
  }

  async function add() {
    if (!mayLeave()) return;
    // Opening "new" again starts a fresh form.
    editing = '';
    await tick();
    editing = NEW;
    await tick();
    formRef?.focusStart();
  }

  async function use(id: string) {
    busy = true;
    try {
      await switchAi(id);
    } finally {
      busy = false;
    }
    // The Use this you pressed is gone: the cursor moves to the AI itself.
    await tick();
    document.querySelector<HTMLElement>(`[data-ai="${id}"]`)?.focus();
  }

  // Saved at once, and opened, so you can rename it and give it its own key.
  async function duplicate(id: string) {
    if (!mayLeave()) return;
    busy = true;
    try {
      await loadSettings();
      const next = duplicateAi(app.settings.ai, id);
      const at = next.saved.findIndex((one) => one.id === id);
      const copy = next.saved[at + 1]!;
      await api.updateSettings({ ai: next });
      await loadSettings();
      editing = copy.id;
      const needsKey = AI_PRESETS[copy.preset].key === 'required';
      showToast(needsKey ? `Added ${copy.name}. Rename it and give it its own API key.` : `Added ${copy.name}.`);
      await tick();
      formRef?.focusName();
    } catch (err) {
      showToast(friendlyError(err));
    } finally {
      busy = false;
    }
  }

  async function remove(id: string) {
    const name = nameOf(all, id);
    if (!confirm(deleteQuestion(all, id, keys.includes(id)))) return;
    busy = true;
    try {
      await loadSettings();
      await api.updateSettings({ ai: removeAi(app.settings.ai, id) });
      await loadSettings();
      setKeys(keys.filter((k) => k !== id));
      if (editing === id) editing = app.settings.ai.active;
      showToast(`Deleted ${name}.`);
    } catch (err) {
      showToast(friendlyError(err));
    } finally {
      busy = false;
    }
    await tick();
    document.querySelector<HTMLElement>(`[data-ai="${app.settings.ai.active}"]`)?.focus();
  }

  async function saved(one: SavedAi, added: boolean) {
    showToast(added ? `Added ${one.name}.` : 'AI settings saved.');
    if (!added) return;
    editing = one.id;
    await tick();
    formRef?.focusStart();
  }

  async function cancel() {
    editing = app.settings.ai.active;
    await tick();
    document.querySelector<HTMLElement>('.my-ais .add')?.focus();
  }
</script>

<section id="ai" aria-labelledby="ai-heading" class="ai-section">
  <h2 id="ai-heading" tabindex="-1">AI</h2>
  {#if ai.known}
    <p class="now" class:bad={ai.state === 'error'}>Right now: {AI_LABEL[ai.state]}.{ai.detail ? ` ${ai.detail}` : ''}</p>
  {/if}
  <p class="muted intro">
    The AI reads the ads you save, rates how well each one fits you, and writes drafts. Keep as many AIs as you like, on this
    computer or in the cloud, and switch between them here or from the AI pill at the top.
  </p>
  {#if ready}
    <div class="writer">
      <label class="writer-field">
        <span class="writer-label">Writes your documents</span>
        <select
          bind:this={writerSelect}
          value={writer}
          onchange={(e) => saveWriter(e.currentTarget.value)}
          onblur={() => saveWriter.flush()}
          aria-describedby={fallback ? 'writer-help writer-missing' : 'writer-help'}
        >
          {#each writerChoices(all) as choice (choice.value)}<option value={choice.value}>{choice.label}</option>{/each}
        </select>
      </label>
      <p id="writer-help" class="muted writer-help">
        Resumes, cover letters, briefs and prep plans. Ratings, quick marks, reading ads and reading emails stay on the AI in use.
      </p>
      {#if fallback}<p id="writer-missing" class="writer-missing">{fallback}</p>{/if}
    </div>
    <AiList ai={all} {keys} {editing} {busy} onopen={open} onadd={add} onuse={use} onduplicate={duplicate} onremove={remove} />
    {#if editing}
      <div class="below">
        {#key editing}
          <AiForm
            bind:this={formRef}
            {base}
            keySaved={keys.includes(editing)}
            bind:dirty={formDirty}
            onsaved={saved}
            oncancel={cancel}
            onkeys={setKeys}
          />
        {/key}
      </div>
    {/if}
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

  .intro {
    max-width: 65ch;
  }

  .ai-section > :global(.my-ais),
  .below,
  .writer {
    width: 100%;
    max-width: 44rem;
  }

  /* The writing AI, a setting of its own above My AIs. It reads as a
     sentence: "Writes your documents: Claude – mine". */
  .writer {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3) 0 var(--space-4);
    border-bottom: 1px solid var(--rule);
    margin-bottom: var(--space-2);
  }

  .writer-field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }

  .writer-label {
    font-weight: 700;
  }

  .writer-field select {
    flex: 0 1 20rem;
    min-width: 0;
  }

  .writer-help {
    font-size: var(--step--1);
    max-width: 65ch;
  }

  .writer-missing {
    max-width: 65ch;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    background: var(--accent-soft);
  }

  .below {
    margin-top: var(--space-4);
    padding-top: var(--space-5);
    border-top: 1px solid var(--rule);
  }
</style>
