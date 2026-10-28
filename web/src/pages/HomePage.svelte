<script lang="ts">
  import { onMount } from 'svelte';
  import type { JobSummary } from '../../../shared/contracts/index.ts';
  import JobList from '../components/JobList.svelte';
  import StatusBadge from '../components/StatusBadge.svelte';
  import { api } from '../lib/api.ts';
  import { statuses } from '../lib/app-state.svelte.ts';
  import { displayCompany, displayTitle, formatDate, snippetParts } from '../lib/format.ts';
  import { JOB_EVENTS, onLive } from '../lib/live.svelte.ts';
  import { search } from '../lib/search.svelte.ts';

  type Group = 'open' | 'closed' | 'all';
  const GROUPS: { id: Group; label: string }[] = [
    { id: 'open', label: 'Open' },
    { id: 'closed', label: 'Closed' },
    { id: 'all', label: 'All' },
  ];

  let group = $state<Group>('open');
  let statusId = $state('');
  let sort = $state<'updated' | 'applied' | 'company'>('updated');
  let jobs = $state<JobSummary[]>([]);
  let anyJobs = $state(true);
  let loaded = $state(false);
  let error = $state<string | null>(null);

  const searching = $derived(search.query.trim() !== '');

  async function load() {
    try {
      jobs = await api.listJobs({ status: statusId || group, sort });
      anyJobs = jobs.length > 0 || (await api.listJobs({ status: 'all' })).length > 0;
      error = null;
    } catch (err) {
      error = (err as Error).message;
    }
    loaded = true;
  }

  $effect(() => {
    // Reload whenever a filter changes.
    void [group, statusId, sort];
    void load();
  });

  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onLive(JOB_EVENTS, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 300);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  });

  function pickGroup(next: Group) {
    group = next;
    statusId = '';
  }
</script>

<main class="page">
  {#if searching}
    <ul id="search-results" role="listbox" aria-label="Search results" class="results">
      {#each search.hits as hit, i (hit.kind === 'job' ? `j${hit.jobId}` : `c${hit.contactId}`)}
        <li id="hit-{i}" role="option" aria-selected={i === search.active} class:active={i === search.active}>
          {#if hit.kind === 'job'}
            <a href="/jobs/{hit.jobId}" tabindex="-1" class="hit">
              <span class="who">
                <strong>{displayCompany(hit.company)}</strong>
                {#if hit.agency}<span class="muted">via {hit.agency}</span>{/if}
              </span>
              <span class="role">{displayTitle(hit.title)}</span>
              <StatusBadge status={hit.status} />
              <span class="numeric muted">{hit.dateApplied ? `Applied ${formatDate(hit.dateApplied)}` : ''}</span>
            </a>
          {:else}
            <div class="hit">
              <span class="who"><strong>{hit.name}</strong>{#if hit.organisation}<span class="muted">{hit.organisation}</span>{/if}</span>
              <span class="role numeric">{hit.phone ?? ''}</span>
              <span class="muted">Not linked to a job yet</span>
            </div>
          {/if}
          {#if hit.snippet}
            <p class="snippet">
              {#each snippetParts(hit.snippet) as part, j (j)}{#if part.mark}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
            </p>
          {/if}
        </li>
      {/each}
    </ul>
    {#if search.searched && search.hits.length === 0}
      <p class="empty">No jobs match "{search.searched}".</p>
    {/if}
    {#if search.error}<p class="error">{search.error}</p>{/if}
  {:else}
    <div class="toolbar">
      <div class="groups">
        {#each GROUPS as g (g.id)}
          <button type="button" class="chip" aria-pressed={!statusId && group === g.id} onclick={() => pickGroup(g.id)}>
            {g.label}
          </button>
        {/each}
      </div>
      <label class="inline">
        <span>Status</span>
        <select bind:value={statusId}>
          <option value="">Any</option>
          {#each statuses() as s (s.id)}
            <option value={s.id}>{s.label}</option>
          {/each}
        </select>
      </label>
      <label class="inline sort">
        <span>Sort</span>
        <select bind:value={sort}>
          <option value="updated">Recently updated</option>
          <option value="applied">Date applied</option>
          <option value="company">Company A–Z</option>
        </select>
      </label>
    </div>

    {#if error}
      <p class="error">{error}</p>
    {:else if jobs.length > 0}
      <JobList {jobs} />
    {:else if loaded}
      <p class="empty">
        {#if anyJobs}No jobs match this filter.{:else}No jobs yet. Press <kbd>N</kbd> or paste a job ad to add one.{/if}
      </p>
    {/if}
  {/if}
</main>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
  }

  .groups {
    display: flex;
    gap: var(--space-1);
  }

  .chip {
    font: inherit;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--rule);
    border-radius: 999px;
    background: transparent;
    color: var(--ink);
    cursor: pointer;
  }

  .chip[aria-pressed='true'] {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--paper);
  }

  .inline {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--step--1);
    color: var(--ink-2);
  }

  .sort {
    margin-left: auto;
  }

  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--rule);
  }

  .results li {
    border-bottom: 1px solid var(--rule);
    padding: var(--space-3);
    border-left: 3px solid transparent;
  }

  .results li.active {
    background: var(--sheet);
    border-left-color: var(--accent);
  }

  .hit {
    display: grid;
    grid-template-columns: minmax(12rem, 1.2fr) 1.5fr auto 10rem;
    gap: var(--space-4);
    align-items: baseline;
    text-decoration: none;
    color: inherit;
  }

  .who {
    display: grid;
  }

  .who .muted {
    font-size: var(--step--1);
  }

  .snippet {
    margin-top: var(--space-1);
    font-size: var(--step--1);
    color: var(--ink-2);
    max-width: 75ch;
  }

  .empty {
    padding: var(--space-6) 0;
    color: var(--ink-2);
  }

  @media (max-width: 40rem) {
    .hit {
      grid-template-columns: 1fr;
      gap: var(--space-1);
    }
  }
</style>
