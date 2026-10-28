<script lang="ts">
  // How well this job fits your profile, from the AI: the verdict and score,
  // the reasons for and against, and any deal-breakers it hits.
  import type { Rating } from '../../../shared/contracts/index.ts';
  import { verdictLabel } from '../lib/format.ts';

  let { match }: { match: Rating } = $props();
</script>

<section aria-labelledby="match-heading" class="match {match.verdict}">
  <h2 id="match-heading">Match</h2>
  <p class="verdict numeric">{verdictLabel(match.verdict)} · {match.score}</p>
  <div class="lists">
    {#if match.why.length > 0}
      <div>
        <h3 id="match-why">Why it fits</h3>
        <ul aria-labelledby="match-why">
          {#each match.why as reason, i (i)}<li>{reason}</li>{/each}
        </ul>
      </div>
    {/if}
    {#if match.whyNot.length > 0}
      <div>
        <h3 id="match-why-not">Why it might not</h3>
        <ul aria-labelledby="match-why-not">
          {#each match.whyNot as reason, i (i)}<li>{reason}</li>{/each}
        </ul>
      </div>
    {/if}
    {#if match.dealBreakers.length > 0}
      <div class="deal-breakers">
        <h3 id="match-deal-breakers">Deal-breakers</h3>
        <ul aria-labelledby="match-deal-breakers">
          {#each match.dealBreakers as reason, i (i)}<li>{reason}</li>{/each}
        </ul>
      </div>
    {/if}
  </div>
  {#if match.salaryNote}<p class="muted">{match.salaryNote}</p>{/if}
</section>

<style>
  .match {
    display: grid;
    gap: var(--space-2);
  }

  h2 {
    font-size: var(--step-0);
  }

  h3 {
    font-size: var(--step--1);
    color: var(--ink-2);
    font-weight: 600;
  }

  .verdict {
    font-size: var(--step-1);
    font-weight: 700;
    margin: 0;
  }

  .strong .verdict,
  .good .verdict {
    color: var(--ok);
  }

  .weak .verdict {
    color: var(--danger);
  }

  .lists {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--space-3) var(--space-5);
  }

  ul {
    margin: var(--space-1) 0 0;
    padding-left: 1.1em;
  }

  .deal-breakers h3,
  .deal-breakers li {
    color: var(--danger);
  }
</style>
