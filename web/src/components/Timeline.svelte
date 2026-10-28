<script lang="ts">
  import { formatDate } from '../lib/format.ts';
  import type { TimelineItem } from '../lib/timeline.ts';

  let { items }: { items: TimelineItem[] } = $props();
</script>

<section aria-labelledby="timeline-heading" class="block">
  <h2 id="timeline-heading">Timeline</h2>
  <ol>
    {#each items as item, i (i)}
      <li data-kind={item.kind}>
        <time class="numeric muted" datetime={item.at}>{formatDate(item.at)}</time>
        <span class="text">{item.text}</span>
      </li>
    {/each}
  </ol>
</section>

<style>
  ol {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
  }

  li {
    display: grid;
    grid-template-columns: 7.5rem 1fr;
    gap: var(--space-4);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--rule);
  }

  li[data-kind='status'] .text {
    font-weight: 600;
  }

  .text {
    white-space: pre-wrap;
    max-width: 75ch;
  }
</style>
