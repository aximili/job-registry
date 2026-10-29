<script lang="ts">
  // One job on the board. Drag it to another column, or choose a status in
  // its "Move to" menu and press Move, which works from the keyboard and with
  // a screen reader. Choosing alone never moves it: on Windows an arrow key
  // already changes a closed menu, and typing a letter does everywhere.
  import { JOB_DRAG_TYPE } from '../lib/board.ts';
  import type { JobSummary, Status } from '../../../shared/contracts/index.ts';
  import { shortDate } from '../../../shared/dates.ts';
  import { lateness, today } from '../lib/follow-up.ts';
  import { displayCompany, displayTitle } from '../lib/format.ts';

  let { job, statuses, onMove }: { job: JobSummary; statuses: Status[]; onMove: (job: JobSummary, to: string) => void } = $props();

  const name = $derived(`${displayTitle(job.title)} at ${displayCompany(job.company ?? job.agency)}`);
  const late = $derived(job.followUpOn ? lateness(job.followUpOn, today()) : '');
  let target = $state('');
</script>

<article
  class="card"
  aria-label={name}
  draggable="true"
  ondragstart={(e) => {
    // Its own type, so dragged text never counts as a card.
    e.dataTransfer?.setData(JOB_DRAG_TYPE, String(job.id));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }}
>
  <a href="/jobs/{job.id}" class="title" draggable="false">{displayTitle(job.title)}</a>
  <p class="muted">{displayCompany(job.company ?? job.agency)}</p>
  {#if job.dateApplied}<p class="muted small numeric">Applied {shortDate(job.dateApplied)}</p>{/if}
  {#if job.followUpOn}
    <p class="small follow-up" class:late={late !== ''}>
      Follow up{late ? `: ${late === 'Today' ? 'today' : late}` : ` ${shortDate(job.followUpOn)}`}
    </p>
  {/if}
  <div class="move">
    <select id="move-{job.id}" aria-label="Move {name} to" bind:value={target}>
      <option value="">Move to…</option>
      {#each statuses.filter((s) => s.id !== job.status) as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
    </select>
    <button
      type="button"
      class="button quiet"
      aria-label="Move {name}"
      disabled={!target}
      onclick={() => {
        const to = target;
        target = '';
        onMove(job, to);
      }}>Move</button
    >
  </div>
</article>

<style>
  .card {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--sheet);
    cursor: grab;
  }

  p {
    margin: 0;
  }

  .title {
    font-weight: 600;
  }

  .small {
    font-size: var(--step--1);
  }

  .follow-up.late {
    color: var(--danger);
    font-weight: 600;
  }

  .move {
    display: flex;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }

  select {
    font: inherit;
    font-size: var(--step--1);
    min-width: 0;
    flex: 1;
  }

  .move .button {
    padding: var(--space-1) var(--space-2);
    font-size: var(--step--1);
  }
</style>
