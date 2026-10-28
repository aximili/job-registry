<script lang="ts">
  // What the AI is doing with this job's ad: still reading it, or it couldn't,
  // with the reason and a button to try again ("Read again").
  import type { Job } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { friendlyError } from '../lib/errors.ts';

  let { job, onChanged }: { job: Job; onChanged: () => void } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);

  async function parseAgain() {
    busy = true;
    error = null;
    try {
      await api.reparseJob(job.id);
      onChanged();
    } catch (err) {
      error = friendlyError(err);
    } finally {
      busy = false;
    }
  }
</script>

{#if job.parseState === 'pending' && job.parseError}
  <div class="state waiting">
    <p>Couldn't read the ad yet. {job.parseError} It will be read the next time the AI works, or press Read again once it's running.</p>
    <button type="button" class="button" disabled={busy} onclick={parseAgain}>Read again</button>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{:else if job.parseState === 'pending'}
  <p class="state" role="status">Reading the ad…</p>
{:else if job.parseState === 'failed'}
  <div class="state failed">
    <p>Couldn't read the ad. {job.parseError ?? ''}</p>
    <button type="button" class="button" disabled={busy} onclick={parseAgain}>Read again</button>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
  .state {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    background: var(--accent-soft);
    font-size: var(--step--1);
  }

  .waiting,
  .failed {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .failed {
    background: color-mix(in srgb, var(--danger) 8%, transparent);
    border-left: 3px solid var(--danger);
    border-radius: 0 var(--radius) var(--radius) 0;
  }

  .waiting p,
  .failed p {
    margin: 0;
  }

  .waiting {
    border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius) var(--radius) 0;
  }
</style>
