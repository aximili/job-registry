<script lang="ts">
  // Find a job by typing part of its company, title or a person's name, then
  // pick it. Used on an Inbox card when the email is about another job.
  import { onMount } from 'svelte';
  import type { JobHit } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { statusLabel } from '../lib/app-state.svelte.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { displayCompany, displayTitle } from '../lib/format.ts';

  let { onPick, onCancel }: { onPick: (job: JobHit) => void; onCancel: () => void } = $props();

  let query = $state('');
  let hits = $state<JobHit[]>([]);
  let error = $state<string | null>(null);
  let input = $state<HTMLInputElement>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;

  onMount(() => {
    input?.focus();
    return () => {
      clearTimeout(timer);
      controller?.abort();
    };
  });

  function find() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      controller?.abort();
      const q = query.trim();
      if (!q) {
        hits = [];
        return;
      }
      const mine = new AbortController();
      controller = mine;
      try {
        const res = await api.search(q, { signal: mine.signal });
        if (mine.signal.aborted) return;
        hits = res.hits.filter((h): h is JobHit => h.kind === 'job');
        error = null;
      } catch (err) {
        if (!mine.signal.aborted) error = friendlyError(err);
      }
    }, 120);
  }
</script>

<!-- Escape closes the search, like a dialog. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="picker"
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }}
>
  <label class="field">
    <span>Find a job</span>
    <input type="search" bind:value={query} bind:this={input} oninput={find} autocomplete="off" />
  </label>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if hits.length > 0}
    <ul>
      {#each hits as hit (hit.jobId)}
        <li>
          <button type="button" class="button quiet" onclick={() => onPick(hit)}>
            {displayTitle(hit.title)} at {displayCompany(hit.company)}<span class="muted"> · {statusLabel(hit.status)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else if query.trim()}
    <p class="muted">No jobs match yet.</p>
  {/if}
  <button type="button" class="button quiet" onclick={onCancel}>Cancel</button>
</div>

<style>
  .picker {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px dashed var(--rule);
    border-radius: var(--radius);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }

  .picker > .button {
    justify-self: start;
  }
</style>
