<script lang="ts">
  import { onMount } from 'svelte';
  import Header from './components/Header.svelte';
  import NewJobDialog from './components/NewJobDialog.svelte';
  import HomePage from './pages/HomePage.svelte';
  import JobPage from './pages/JobPage.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';
  import { loadSettings, watchSettings } from './lib/app-state.svelte.ts';
  import { isShortcut, isTypingTarget } from './lib/keys.ts';
  import { navigate, router } from './lib/router.svelte.ts';
  import { registerNewJob } from './lib/new-job.svelte.ts';
  import { focusSearch } from './lib/search.svelte.ts';
  import { toast } from './lib/toast.svelte.ts';

  let newJob = $state<NewJobDialog>();

  onMount(() => {
    void loadSettings();
    const stopWatching = watchSettings();
    const unregister = registerNewJob((text) => void newJob?.open(text));
    return () => {
      stopWatching();
      unregister();
    };
  });

  const dialogOpen = () => document.querySelector('dialog[open]') !== null;

  function onKeydown(event: KeyboardEvent) {
    // "/" or Ctrl+K jumps to search from anywhere, but never out of an open
    // dialog: that would throw away what you were typing.
    if (dialogOpen()) return;
    const ctrlK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    if (ctrlK || isShortcut(event, '/')) {
      event.preventDefault();
      if (router.route.name !== 'home') navigate('/');
      focusSearch();
    } else if (isShortcut(event, 'n')) {
      event.preventDefault();
      newJob?.open();
    }
  }

  // Paste an ad or a link anywhere outside a text field to start a new job.
  function onPaste(event: ClipboardEvent) {
    if (isTypingTarget(document.activeElement) || dialogOpen()) return;
    const text = event.clipboardData?.getData('text') ?? '';
    if (!text.trim()) return;
    event.preventDefault();
    newJob?.open(text);
  }
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:document onpaste={onPaste} />

<Header onNewJob={() => newJob?.open()} />

{#if router.route.name === 'home'}
  <HomePage />
{:else if router.route.name === 'job'}
  {#key router.route.id}
    <JobPage id={router.route.id} />
  {/key}
{:else if router.route.name === 'settings'}
  <SettingsPage />
{:else}
  <main class="page">
    <h1>There's no page at this address.</h1>
    <p><a href="/">Go to your jobs</a></p>
  </main>
{/if}

<NewJobDialog bind:this={newJob} />

<div class="toast" role="status" aria-live="polite">{toast.message}</div>

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: var(--space-5);
    transform: translateX(-50%);
    max-width: calc(100vw - 2rem);
    padding: var(--space-3) var(--space-5);
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--paper);
    font-weight: 600;
  }

  .toast:empty {
    display: none;
  }
</style>
