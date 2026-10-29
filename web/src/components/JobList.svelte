<script lang="ts">
  import type { JobSummary } from '../../../shared/contracts/index.ts';
  import { displayCompany, displayTitle, formatDate, formatRelative } from '../lib/format.ts';
  import StatusBadge from './StatusBadge.svelte';

  let { jobs }: { jobs: JobSummary[] } = $props();
</script>

<table aria-label="Jobs">
  <thead>
    <tr>
      <th scope="col">Company</th>
      <th scope="col">Role</th>
      <th scope="col">Status</th>
      <th scope="col">Applied</th>
      <th scope="col">Updated</th>
    </tr>
  </thead>
  <tbody>
    {#each jobs as job (job.id)}
      <tr>
        <td>
          <a href="/jobs/{job.id}" class="row-link">{displayCompany(job.company)}</a>
          {#if job.agency}<span class="muted">via {job.agency}</span>{/if}
        </td>
        <td>{displayTitle(job.title)}</td>
        <td><StatusBadge status={job.status} /></td>
        <td class="numeric">{formatDate(job.dateApplied)}</td>
        <td class="numeric muted">{formatRelative(job.updatedAt)}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  table {
    width: 100%;
    /* Separate borders, so the card's corners can be round. */
    border-collapse: separate;
    border-spacing: 0;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--sheet);
  }

  th {
    text-align: left;
    font-size: var(--step--1);
    font-weight: 600;
    color: var(--ink-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--rule);
    background: var(--sheet-2);
  }

  th:first-child {
    border-top-left-radius: var(--radius);
  }

  th:last-child {
    border-top-right-radius: var(--radius);
  }

  td {
    padding: var(--space-3);
    border-bottom: 1px solid var(--rule);
    vertical-align: top;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  tr {
    position: relative;
  }

  tbody tr:hover {
    background: var(--sheet-2);
  }

  .row-link {
    font-weight: 700;
    text-decoration: none;
  }

  /* The whole row opens the job, while the link stays the one thing keyboards tab to. */
  .row-link::after {
    content: '';
    position: absolute;
    inset: 0;
  }

  td .muted {
    display: block;
    font-size: var(--step--1);
  }

  @media (max-width: 40rem) {
    th:nth-child(4),
    td:nth-child(4),
    th:nth-child(5),
    td:nth-child(5) {
      display: none;
    }
  }
</style>
