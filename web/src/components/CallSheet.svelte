<script lang="ts">
  import type { CallSheet } from '../../../shared/contracts/index.ts';
  import { displayCompany, displayTitle, EMPLOYMENT_LABEL, formatDate, formatSalary, WORK_MODE_LABEL } from '../lib/format.ts';
  import MatchPanel from './MatchPanel.svelte';
  import NotesPanel from './NotesPanel.svelte';
  import ParseState from './ParseState.svelte';
  import PeopleList from './PeopleList.svelte';
  import StatusPicker from './StatusPicker.svelte';

  let {
    sheet,
    onStatusChange,
    onLogCall,
    onEdit,
    onArchive,
    onChanged,
  }: {
    sheet: CallSheet;
    onStatusChange: (status: string) => void;
    onLogCall: () => void;
    onEdit: () => void;
    onArchive: () => void;
    onChanged: () => void;
  } = $props();

  const job = $derived(sheet.job);
  const work = $derived([WORK_MODE_LABEL[job.workMode], EMPLOYMENT_LABEL[job.employmentType]].filter(Boolean).join(', '));
  const salary = $derived(formatSalary(job.salary));
  const fromAi = $derived(Object.values(job.fieldSources).includes('ai'));

  // Only facts we know are shown. An empty row helps no one mid-call.
  const facts = $derived(
    [
      { label: 'Applied', value: formatDate(job.dateApplied) },
      { label: 'Location', value: job.location ?? '' },
      { label: 'Work', value: work },
      { label: 'Salary', value: salary },
      { label: 'Closes', value: formatDate(job.closingDate) },
    ].filter((f) => f.value),
  );
</script>

<section aria-label="Call sheet" class="sheet">
  <div class="head">
    <div class="who">
      <p class="company">
        {displayCompany(job.company)}
        {#if job.agency}<span class="muted">via {job.agency}</span>{/if}
      </p>
      <h1>{displayTitle(job.title)}</h1>
    </div>
    <StatusPicker status={job.status} onChange={onStatusChange} />
  </div>

  <ParseState {job} {onChanged} />

  {#if facts.length > 0}
    <dl class="facts">
      {#each facts as fact (fact.label)}
        <div>
          <dt>{fact.label}</dt>
          <dd class="numeric">{fact.value}</dd>
        </div>
      {/each}
    </dl>
  {/if}
  {#if fromAi}
    <p class="muted ai-note">Some details were filled in by the AI. Press <kbd>E</kbd> to check them.</p>
  {/if}

  {#if job.requirements.length > 0}
    <div class="requirements">
      <h2>Key requirements</h2>
      <ul>
        {#each job.requirements.slice(0, 6) as requirement, i (i)}
          <li>{requirement}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if job.match}<MatchPanel match={job.match} />{/if}

  <div class="columns">
    <PeopleList people={sheet.people} {onLogCall} />
    <NotesPanel jobId={job.id} notes={sheet.notes} onSaved={onChanged} />
  </div>

  <div class="actions">
    <button type="button" class="button" onclick={onEdit}>Edit <kbd>E</kbd></button>
    <details class="more">
      <summary class="button quiet">More</summary>
      <div class="menu">
        <button type="button" class="button quiet" onclick={onArchive}>Archive job</button>
      </div>
    </details>
  </div>
</section>

<style>
  .ai-note {
    font-size: var(--step--1);
    margin: calc(-1 * var(--space-3)) 0 0;
  }

  .sheet {
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: var(--space-5);
    display: grid;
    gap: var(--space-5);
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .company {
    font-size: var(--step-1);
    font-weight: 700;
  }

  .company .muted {
    font-weight: 400;
    font-size: var(--step-0);
    margin-left: var(--space-2);
  }

  h1 {
    font-size: var(--step-3);
    margin-top: var(--space-1);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3) var(--space-6);
    margin: 0;
    padding: var(--space-3) 0;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
  }

  dt {
    font-size: var(--step--1);
    color: var(--ink-2);
  }

  dd {
    margin: 0;
    font-weight: 600;
  }

  .requirements h2 {
    font-size: var(--step-0);
    margin-bottom: var(--space-2);
  }

  .requirements ul {
    margin: 0;
    padding-left: 1.2rem;
    columns: 2;
    column-gap: var(--space-6);
  }

  .columns {
    display: grid;
    grid-template-columns: 1fr 1.3fr;
    gap: var(--space-6);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .more {
    position: relative;
  }

  .more summary {
    list-style: none;
  }

  .more summary::-webkit-details-marker {
    display: none;
  }

  .menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 2;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: var(--space-1);
    white-space: nowrap;
  }

  @media (max-width: 48rem) {
    .columns {
      grid-template-columns: 1fr;
    }

    .requirements ul {
      columns: 1;
    }
  }

  :global(.panel-head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
    /* Same height with or without a button, so side-by-side headings line up. */
    min-height: 2.75rem;
  }

  :global(.panel h2),
  :global(.block h2) {
    font-size: var(--step-1);
  }
</style>
