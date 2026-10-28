<script lang="ts">
  import type { Posting } from '../../../shared/contracts/index.ts';
  import { formatDate } from '../lib/format.ts';
  import { adSourceText } from '../lib/timeline.ts';

  let { postings }: { postings: Posting[] } = $props();

  // Long ads start folded to about 12 lines.
  const LONG = 900;
  let open = $state<Record<number, boolean>>({});
</script>

<section aria-labelledby="ad-heading" class="block">
  <h2 id="ad-heading">Saved ad</h2>
  {#each postings as posting (posting.id)}
    <article>
      <p class="muted source">
        {adSourceText(posting.sourceSite)}, {formatDate(posting.capturedAt)}.
        {#if posting.sourceUrl}
          <a href={posting.sourceUrl} target="_blank" rel="noopener noreferrer">Open the original ad</a>
        {/if}
      </p>
      {#if posting.jdText}
        <div class="ad-text" class:folded={posting.jdText.length > LONG && !open[posting.id]}>{posting.jdText}</div>
        {#if posting.jdText.length > LONG}
          <button type="button" class="button quiet" onclick={() => (open[posting.id] = !open[posting.id])}>
            {open[posting.id] ? 'Fold the ad' : 'Show the whole ad'}
          </button>
        {/if}
      {:else}
        <p class="muted">No ad text was saved for this one.</p>
      {/if}
    </article>
  {/each}
</section>

<style>
  article {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--rule);
  }

  .source {
    font-size: var(--step--1);
    margin-bottom: var(--space-2);
  }

  .ad-text {
    white-space: pre-wrap;
    max-width: 75ch;
  }

  .folded {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 12;
    line-clamp: 12;
    overflow: hidden;
  }
</style>
