<script lang="ts">
  // Settings → AI's "My AIs": every saved AI, with its provider and model,
  // which one is in use, and Use this, Duplicate and Delete. Pressing an AI
  // opens it in the form below the list.
  import type { AiSettings } from '../../../shared/contracts/index.ts';
  import { aiSummary, deleteBlock, noKeyYet } from '../lib/ai-list.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  let {
    ai,
    keys,
    editing,
    busy = false,
    onopen,
    onadd,
    onuse,
    onduplicate,
    onremove,
  }: {
    ai: AiSettings;
    // The ids of the AIs that have an API key.
    keys: string[];
    // The AI open in the form, or 'new'.
    editing: string;
    busy?: boolean;
    onopen: (id: string) => void;
    onadd: () => void;
    onuse: (id: string) => void;
    onduplicate: (id: string) => void;
    onremove: (id: string) => void;
  } = $props();

  const needsKey = (id: string) => {
    const one = ai.saved.find((s) => s.id === id);
    return one !== undefined && noKeyYet(one, keys);
  };

  // A Delete that can't be used still takes the cursor, and says why.
  function remove(id: string) {
    const block = deleteBlock(ai, id);
    if (block) showToast(block);
    else onremove(id);
  }
</script>

<div class="my-ais">
  <div class="list-head">
    <h3 id="my-ais-heading">My AIs</h3>
    <button type="button" class="button add" disabled={busy} onclick={onadd}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8M2 6h8" /></svg>
      Add an AI
    </button>
  </div>
  <ul aria-labelledby="my-ais-heading">
    {#each ai.saved as one (one.id)}
      {@const inUse = one.id === ai.active}
      {@const open = one.id === editing}
      {@const block = deleteBlock(ai, one.id)}
      <li class:open class:in-use={inUse}>
        <div class="row">
          <button
            type="button"
            class="open-ai"
            data-ai={one.id}
            aria-current={open ? 'true' : undefined}
            onclick={() => onopen(one.id)}
          >
            <span class="name">{one.name}</span>
            <span class="summary">{aiSummary(one)}</span>
            {#if needsKey(one.id)}<span class="no-key">No API key yet</span>{/if}
          </button>
          <div class="actions">
            {#if inUse}
              <span class="in-use-tag">In use</span>
            {:else}
              <button type="button" class="button use" aria-label="Use this: {one.name}" disabled={busy} onclick={() => onuse(one.id)}>
                Use this
              </button>
            {/if}
            <button type="button" class="button quiet small" aria-label="Duplicate {one.name}" disabled={busy} onclick={() => onduplicate(one.id)}>
              Duplicate
            </button>
            <button
              type="button"
              class="button quiet small"
              aria-label="Delete {one.name}"
              aria-disabled={block ? 'true' : undefined}
              aria-describedby={block ? `delete-why-${one.id}` : undefined}
              title={block ?? undefined}
              disabled={busy}
              onclick={() => remove(one.id)}
            >
              Delete
            </button>
            <!-- Why it can't be used, read out when the cursor reaches it. -->
            {#if block}<span id="delete-why-{one.id}" class="visually-hidden">{block}</span>{/if}
          </div>
        </div>
      </li>
    {/each}
  </ul>
</div>

<style>
  .my-ais {
    display: grid;
    gap: var(--space-2);
    align-content: start;
    min-width: 0;
  }

  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .list-head h3 {
    font-size: var(--step-0);
  }

  /* One line per AI, like a table. The open one carries the accent down its
     spine, like the open tab of the Settings menu. */
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
  }

  li {
    padding-right: var(--space-2);
  }

  li + li {
    border-top: 1px solid var(--rule);
  }

  li.open {
    background: var(--sheet-2);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .open-ai {
    font: inherit;
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 0.1rem;
    padding: var(--space-2) var(--space-3);
    border: 0;
    background: transparent;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }

  .name {
    font-weight: 700;
  }

  .summary {
    font-size: var(--step--1);
    color: var(--ink-2);
    overflow-wrap: anywhere;
  }

  .no-key {
    font-size: var(--step--1);
    font-weight: 700;
    color: var(--danger);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex: none;
  }

  .in-use-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    padding: 0 var(--space-3);
    min-width: 6.5rem;
    font-weight: 700;
    color: var(--accent);
  }

  .in-use-tag::before {
    content: '';
    width: 0.6em;
    height: 0.6em;
    border-radius: 50%;
    background: currentColor;
  }

  .use {
    min-width: 6.5rem;
    justify-content: center;
  }

  .small {
    padding: var(--space-2) var(--space-2);
    color: var(--ink-2);
  }

  .small:hover {
    color: var(--ink);
  }

  .add svg {
    width: 0.8em;
    height: 0.8em;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
  }

  /* A narrow window: the buttons go under the AI's name. */
  @media (max-width: 40rem) {
    .row {
      flex-wrap: wrap;
    }

    .actions {
      padding: 0 0 var(--space-2) var(--space-3);
    }
  }
</style>
