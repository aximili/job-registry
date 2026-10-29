<script lang="ts">
  // The board: a column per status. Moving a card changes the job's status
  // the usual way, so it's in the history and sets "date applied" as usual.
  import { onMount, tick } from 'svelte';
  import type { JobSummary } from '../../../shared/contracts/index.ts';
  import BoardCard from '../components/BoardCard.svelte';
  import { api } from '../lib/api.ts';
  import { statusLabel, statuses } from '../lib/app-state.svelte.ts';
  import { boardColumns, JOB_DRAG_TYPE, OTHER } from '../lib/board.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { displayTitle, plural } from '../lib/format.ts';
  import { JOB_EVENTS, onLive, onReconnect } from '../lib/live.svelte.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  const CLOSED_KEY = 'jr-board-closed';

  let jobs = $state<JobSummary[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let showClosed = $state(localStorage.getItem(CLOSED_KEY) === '1');
  let over = $state<string | null>(null);
  let heading = $state<HTMLHeadingElement>();
  // Moves still being sent: a live reload then would show the old column.
  let moving = 0;

  const columns = $derived(boardColumns(jobs, statuses(), { showClosed }));

  async function load() {
    try {
      const list = await api.listJobs({ status: 'all' });
      if (moving === 0) jobs = list;
      error = null;
    } catch (err) {
      error = friendlyError(err);
    }
    loaded = true;
  }

  onMount(() => {
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 300);
    };
    const off = onLive(JOB_EVENTS, reload);
    const offReconnect = onReconnect(reload);
    return () => {
      clearTimeout(timer);
      off();
      offReconnect();
    };
  });

  $effect(() => {
    localStorage.setItem(CLOSED_KEY, showClosed ? '1' : '0');
  });

  const place = (id: number, status: string) => (jobs = jobs.map((j) => (j.id === id ? { ...j, status } : j)));

  // A moved card is drawn again in its new column, which drops the focus.
  // Put it back on the card's menu (or the heading when its column is
  // hidden), unless you've already moved on to something else.
  async function refocus(id: number) {
    await tick();
    const active = document.activeElement;
    if (active && active !== document.body && !heading?.closest('main')?.contains(active)) return;
    (document.getElementById(`move-${id}`) ?? heading)?.focus();
  }

  async function move(job: JobSummary, to: string) {
    if (job.status === to) return;
    const from = job.status;
    moving++;
    error = null;
    place(job.id, to);
    void refocus(job.id);
    try {
      const saved = await api.changeStatus(job.id, to);
      jobs = jobs.map((j) => (j.id === job.id ? { ...j, status: saved.status, dateApplied: saved.dateApplied, updatedAt: saved.updatedAt } : j));
      showToast(`Moved ${displayTitle(job.title)} to ${statusLabel(to)}.`);
      await refocus(job.id);
    } catch (err) {
      place(job.id, from);
      error = friendlyError(err);
      await refocus(job.id);
    } finally {
      moving--;
    }
  }

  function drop(event: DragEvent, to: string) {
    event.preventDefault();
    over = null;
    const raw = event.dataTransfer?.getData(JOB_DRAG_TYPE);
    const job = raw ? jobs.find((j) => j.id === Number(raw)) : undefined;
    if (job) void move(job, to);
  }
</script>

<main class="page wide">
  <div class="bar">
    <h1 bind:this={heading} tabindex="-1">Board</h1>
    <label class="check"><input type="checkbox" bind:checked={showClosed} /> Show closed statuses</label>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if loaded}
    <div class="columns">
      {#each columns as col (col.id)}
        <section
          class="column"
          class:over={over === col.id}
          aria-label="{col.label}, {plural(col.jobs.length, 'job')}"
          ondragover={(e) => {
            // Only a card can be dropped, and never on Other.
            if (col.id === OTHER || !e.dataTransfer?.types.includes(JOB_DRAG_TYPE)) return;
            e.preventDefault();
            over = col.id;
          }}
          ondragleave={() => (over = over === col.id ? null : over)}
          ondrop={(e) => col.id !== OTHER && drop(e, col.id)}
        >
          <h2>{col.label} <span class="count">{col.jobs.length}</span></h2>
          {#if col.jobs.length === 0}
            <p class="muted empty">No jobs</p>
          {:else}
            {#each col.jobs as job (job.id)}
              <BoardCard {job} statuses={statuses()} onMove={move} />
            {/each}
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</main>

<style>
  .wide {
    max-width: none;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  h1:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .columns {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(14rem, 1fr);
    gap: var(--space-3);
    overflow-x: auto;
    padding-bottom: var(--space-3);
    margin-top: var(--space-4);
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 12rem;
    padding: var(--space-2);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--rule) 30%, transparent);
    outline: 2px dashed transparent;
  }

  .column.over {
    outline-color: var(--accent);
  }

  h2 {
    margin: 0;
    font-size: var(--step--1);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    display: flex;
    justify-content: space-between;
  }

  .count {
    color: var(--ink-2);
  }

  .empty {
    margin: 0;
    font-size: var(--step--1);
  }
</style>
