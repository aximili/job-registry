<script lang="ts">
  // The Inbox: emails that look like they're about your jobs, as cards you
  // confirm, move to another job, or dismiss. Nothing changes by itself.
  import { onMount, tick } from 'svelte';
  import type { EmailStatus, EmailSuggestion } from '../../../shared/contracts/index.ts';
  import SuggestionCard from '../components/SuggestionCard.svelte';
  import { api } from '../lib/api.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { formatRelative, plural } from '../lib/format.ts';
  import { EMAIL_EVENTS, refreshInbox } from '../lib/inbox.svelte.ts';
  import { onLive, onReconnect } from '../lib/live.svelte.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  let status = $state<EmailStatus | null>(null);
  let cards = $state<EmailSuggestion[]>([]);
  let loaded = $state(false);
  let checking = $state(false);
  let error = $state<string | null>(null);
  let heading = $state<HTMLHeadingElement>();

  const ready = $derived(status !== null && status.enabled && status.configured);

  async function load() {
    try {
      const [s, list] = await Promise.all([refreshInbox(), api.emailSuggestions()]);
      status = s;
      cards = list;
      error = null;
    } catch (err) {
      error = friendlyError(err);
    }
    loaded = true;
  }

  onMount(() => {
    void load();
    heading?.focus();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 200);
    };
    const off = onLive([...EMAIL_EVENTS, 'job.statusChanged', 'job.updated'], reload);
    const offReconnect = onReconnect(reload);
    return () => {
      clearTimeout(timer);
      off();
      offReconnect();
    };
  });

  async function checkNow() {
    checking = true;
    error = null;
    try {
      status = await api.checkEmail();
      cards = await api.emailSuggestions();
    } catch (err) {
      error = friendlyError(err);
    } finally {
      checking = false;
    }
  }

  async function done(id: number, message: string) {
    const at = cards.findIndex((c) => c.id === id);
    cards = cards.filter((c) => c.id !== id);
    showToast(message);
    void refreshInbox().catch(() => undefined);
    await tick();
    // The focus moves to the next card, or back to the page heading.
    const next = cards[Math.min(at, cards.length - 1)];
    const target = next ? document.getElementById(`suggestion-${next.id}`) : heading;
    target?.focus();
  }
</script>

<main class="page">
  <h1 bind:this={heading} tabindex="-1">Inbox</h1>

  {#if loaded && status}
    {#if ready}
      <div class="bar">
        <p class="muted" role="status">
          {#if status.checking || checking}
            Checking Gmail…
          {:else if status.lastCheckAt}
            Last checked {formatRelative(status.lastCheckAt)}{status.lastAdded ? ` · ${plural(status.lastAdded, 'new email')}` : ''}.
          {:else}
            Not checked yet.
          {/if}
        </p>
        <button type="button" class="button" disabled={checking} onclick={checkNow}>{checking ? 'Checking…' : 'Check now'}</button>
      </div>
      {#if status.lastError && !checking}<p class="error" role="alert">{status.lastError}</p>{/if}
    {:else}
      <p>Connect Gmail in <a href="/settings#email">Settings → Email</a> to see emails about your jobs here.</p>
    {/if}
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if cards.length > 0}
    <div class="cards">
      {#each cards as card (card.id)}
        <SuggestionCard suggestion={card} onDone={done} />
      {/each}
    </div>
  {:else if loaded && ready}
    <p class="muted">Nothing to check. Emails about your jobs show up here.</p>
  {/if}
</main>

<style>
  h1:focus {
    outline: none;
  }

  .bar {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    justify-content: space-between;
  }

  .cards {
    display: grid;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }
</style>
