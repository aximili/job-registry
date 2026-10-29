<script lang="ts">
  import { onMount } from 'svelte';
  import { inbox, watchInbox } from '../lib/inbox.svelte.ts';
  import AiPill from './AiPill.svelte';
  import SearchBox from './SearchBox.svelte';

  let { onNewJob }: { onNewJob?: () => void } = $props();

  const pending = $derived(inbox.status?.pending ?? 0);

  onMount(() => watchInbox());
</script>

<header>
  <div class="bar">
    <a href="/" class="brand">Job Registry</a>
    <nav aria-label="Main">
      <AiPill />
      {#if onNewJob}
        <button type="button" class="button primary" onclick={onNewJob}>New job <kbd>N</kbd></button>
      {/if}
      <a href="/board" class="button quiet">Board</a>
      <a href="/inbox" class="button quiet" aria-label={pending > 0 ? `Inbox, ${pending} to check` : 'Inbox'}>
        Inbox{#if pending > 0}<span class="count" aria-hidden="true">{pending}</span>{/if}
      </a>
      <a href="/settings" class="button quiet">Settings</a>
    </nav>
  </div>
  <SearchBox />
</header>

<style>
  header {
    max-width: var(--width);
    margin: 0 auto;
    padding: var(--space-4) var(--space-5) 0;
    display: grid;
    gap: var(--space-3);
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .brand {
    font-weight: 700;
    text-decoration: none;
    letter-spacing: 0.01em;
  }

  nav {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .count {
    min-width: 1.4em;
    padding: 0 var(--space-1);
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--step--1);
    text-align: center;
  }

  .primary kbd {
    border-color: color-mix(in srgb, var(--accent-ink) 40%, transparent);
    color: var(--accent-ink);
    background: transparent;
  }
</style>
