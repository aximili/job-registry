<script lang="ts">
  import type { Candidate, SourceSite } from '../../../shared/contracts/index.ts';
  import { statusLabel } from '../lib/app-state.svelte.ts';
  import { displayCompany, displayTitle, formatDate, joinList } from '../lib/format.ts';

  let {
    candidates,
    busy,
    onSame,
    onDifferent,
  }: { candidates: Candidate[]; busy: boolean; onSame: (jobId: number) => void; onDifferent: () => void } = $props();

  const SITE: Record<SourceSite, string> = {
    seek: 'Seek',
    linkedin: 'LinkedIn',
    indeed: 'Indeed',
    other: 'another website',
    pasted: 'pasted text',
  };

  function describe(c: Candidate): string {
    const sites = joinList(c.sourceSites.map((s) => SITE[s]));
    const status = [statusLabel(c.status), formatDate(c.dateApplied)].filter(Boolean).join(' ');
    return `Looks like ${displayTitle(c.title)} at ${displayCompany(c.company ?? c.agency)} (from ${sites}, ${status}).`;
  }
</script>

<div class="same">
  {#each candidates as candidate (candidate.jobId)}
    <div class="candidate">
      <p>{describe(candidate)}</p>
      {#if candidate.strength === 'possible'}
        <p class="muted small">This is only a possible match, based on the role and city.</p>
      {/if}
      <button type="button" class="button primary" disabled={busy} onclick={() => onSame(candidate.jobId)}>Same job</button>
    </div>
  {/each}
  <div class="dialog-actions">
    <button type="button" class="button" disabled={busy} onclick={onDifferent}>Different job</button>
  </div>
</div>

<style>
  .same {
    display: grid;
    gap: var(--space-4);
  }

  .candidate {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
    padding: var(--space-3) var(--space-4);
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    border-radius: 0 var(--radius) var(--radius) 0;
  }

  .small {
    font-size: var(--step--1);
  }
</style>
