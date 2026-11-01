<script lang="ts">
  // A model name you can type, or pick: our suggestions first, each with its
  // tag ("Best value"), then the provider's own list, asked for the first
  // time you open it. Typing narrows the list; any name you type is kept.
  import type { AiModelsResult } from '../../../shared/contracts/index.ts';
  import { friendlyError } from '../lib/errors.ts';

  let {
    value = $bindable(''),
    label,
    id,
    describedby,
    placeholder = '',
    provider,
    suggestions,
    canList,
    source,
    load,
  }: {
    value?: string;
    label: string;
    id: string;
    describedby?: string;
    placeholder?: string;
    // The provider's name, for "From Claude (Anthropic API)".
    provider: string;
    suggestions: { id: string; tag: string }[];
    // false: the provider has no list to ask for.
    canList: boolean;
    // Changes when the address or key changes, so the list is asked for again.
    source: string;
    load: () => Promise<AiModelsResult>;
  } = $props();

  type Option = { id: string; tag: string | null };

  let open = $state(false);
  // What the list is narrowed to: null shows everything.
  let filter = $state<string | null>(null);
  let active = $state(-1);
  let fetched = $state<string[]>([]);
  let loadedFor = $state<string | null>(null);
  let loading = $state(false);
  let failed = $state<string | null>(null);
  let input = $state<HTMLInputElement>();

  const listId = $derived(`${id}-list`);
  const query = $derived(filter?.trim().toLowerCase() ?? '');
  const matches = (o: Option) => !query || o.id.toLowerCase().includes(query);
  const suggested = $derived(suggestions.map((s): Option => ({ id: s.id, tag: s.tag })).filter(matches));
  const others = $derived(
    fetched
      .filter((m) => !suggestions.some((s) => s.id === m))
      .map((m): Option => ({ id: m, tag: null }))
      .filter(matches),
  );
  const options = $derived([...suggested, ...others]);

  async function fetchList() {
    if (!canList || loadedFor === source || loading) return;
    const asked = source;
    loading = true;
    failed = null;
    try {
      const res = await load();
      if (asked !== source) return;
      fetched = res.models;
      failed = res.ok ? null : (res.detail ?? "The provider didn't answer.");
      loadedFor = asked;
    } catch (err) {
      failed = friendlyError(err);
    } finally {
      loading = false;
    }
  }

  function show(narrow: string | null) {
    open = true;
    filter = narrow;
    void fetchList();
  }

  function hide() {
    open = false;
    active = -1;
  }

  function pick(o: Option) {
    value = o.id;
    hide();
    input?.focus();
  }

  function move(step: number) {
    if (!open) {
      show(null);
      active = Math.max(
        0,
        options.findIndex((o) => o.id === value),
      );
      return;
    }
    if (options.length === 0) return;
    active = (active + step + options.length) % options.length;
  }

  $effect(() => {
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter' && open && active >= 0 && options[active]) {
      event.preventDefault();
      pick(options[active]);
    } else if (event.key === 'Escape' && open) {
      // Escape closes the list here, and never reaches the page.
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
  }
</script>

<div class="picker">
  <label class="field" for={id}><span>{label}</span></label>
  <div class="box">
    <input
      {id}
      bind:this={input}
      bind:value
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      aria-describedby={describedby}
      autocomplete="off"
      spellcheck="false"
      {placeholder}
      oninput={() => {
        show(value);
        active = -1;
      }}
      {onkeydown}
      onblur={hide}
    />
    <button
      type="button"
      class="toggle"
      tabindex="-1"
      aria-label="Show the list"
      onmousedown={(e) => e.preventDefault()}
      onclick={() => {
        if (open) hide();
        else show(null);
        input?.focus();
      }}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
    </button>
    {#if open}
      <ul class="list" id={listId} role="listbox" aria-label={label}>
        {#each options as o, i (o.id)}
          {#if i === 0 && suggested.length > 0}<li class="group" role="presentation">Suggested</li>{/if}
          {#if i === suggested.length && others.length > 0}<li class="group" role="presentation">From {provider}</li>{/if}
          <!-- The keyboard works through the box above (the arrows and Enter). -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            id="{listId}-{i}"
            role="option"
            tabindex="-1"
            aria-selected={i === active}
            class:active={i === active}
            class:current={o.id === value}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => pick(o)}
          >
            <span class="id">{o.id}</span>
            {#if o.tag}<span class="tag">{o.tag}</span>{/if}
          </li>
        {/each}
        {#if loading}
          <li class="note" role="presentation">Asking {provider} for its list…</li>
        {:else if failed}
          <li class="note" role="presentation">Couldn't get the list: {failed}</li>
        {:else if !canList}
          <li class="note" role="presentation">{provider} doesn't share a list. Type the model's name if it isn't here.</li>
        {/if}
        {#if options.length === 0 && !loading && query}
          <li class="note" role="presentation">Nothing matches. The name you typed is used as it is.</li>
        {/if}
      </ul>
    {/if}
  </div>
</div>

<style>
  .picker {
    display: grid;
    gap: var(--space-1);
  }

  .box {
    position: relative;
  }

  input {
    width: 100%;
    padding-right: 2.25rem;
  }

  .toggle {
    position: absolute;
    top: 1px;
    right: 1px;
    bottom: 1px;
    width: 2rem;
    display: grid;
    place-items: center;
    border: 0;
    border-left: 1px solid var(--rule);
    border-radius: 0 var(--radius) var(--radius) 0;
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
  }

  .toggle svg {
    width: 0.8rem;
    height: 0.8rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .list {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    z-index: 10;
    max-height: 16rem;
    overflow-y: auto;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    border: 1px solid var(--edge);
    border-radius: var(--radius);
    background: var(--sheet);
    box-shadow: 0 8px 24px rgb(10 15 30 / 0.22);
  }

  [role='option'] {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-2);
    border-radius: 4px;
    cursor: pointer;
  }

  [role='option']:hover,
  [role='option'].active {
    background: var(--accent-soft);
  }

  .id {
    overflow-wrap: anywhere;
  }

  /* The model in the box now. */
  .current .id {
    font-weight: 700;
  }

  .tag {
    flex: none;
    font-size: var(--step--1);
    font-weight: 700;
    color: var(--accent);
  }

  .group {
    padding: var(--space-2) var(--space-2) var(--space-1);
    font-size: var(--step--1);
    font-weight: 700;
    color: var(--ink-2);
  }

  .note {
    padding: var(--space-2);
    font-size: var(--step--1);
    color: var(--ink-2);
  }
</style>
