<script lang="ts">
  import { onMount } from 'svelte';
  import { looksLikeAd, openNewJob } from '../lib/new-job.svelte.ts';
  import { navigate, router } from '../lib/router.svelte.ts';
  import { clearSearch, moveActive, search, searchNow, setQuery } from '../lib/search.svelte.ts';

  let input: HTMLInputElement;

  const open = $derived(search.query.trim() !== '' && router.route.name === 'home');

  onMount(() => {
    // The phone is ringing: the cursor is already in the box.
    if (router.route.name === 'home') input.focus();
  });

  function onInput(event: Event & { currentTarget: HTMLInputElement }) {
    setQuery(event.currentTarget.value);
    if (router.route.name !== 'home') navigate('/');
  }

  // Enter always opens a result for what is typed now, even if you press it
  // before the results have caught up with your typing.
  async function openActive() {
    if (search.searched !== search.query) await searchNow();
    if (search.searched !== search.query) return;
    const hit = search.hits[search.active];
    if (hit?.kind === 'job') {
      input.blur();
      navigate(`/jobs/${hit.jobId}`);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void openActive();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      clearSearch();
    }
  }

  // A pasted link or ad starts a new job. A pasted name or phone number is searched for.
  function onPaste(event: ClipboardEvent) {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!looksLikeAd(text)) return;
    event.preventDefault();
    openNewJob(text);
  }
</script>

<div class="search" role="search">
  <input
    id="search-box"
    bind:this={input}
    type="search"
    role="combobox"
    aria-label="Search jobs"
    aria-expanded={open}
    aria-controls="search-results"
    aria-autocomplete="list"
    aria-activedescendant={open && search.hits.length > 0 ? `hit-${search.active}` : undefined}
    placeholder="Search company, role, person or phone"
    autocomplete="off"
    spellcheck="false"
    maxlength="200"
    value={search.query}
    oninput={onInput}
    onkeydown={onKeydown}
    onpaste={onPaste}
  />
  <kbd aria-hidden="true">/</kbd>
</div>

<style>
  .search {
    position: relative;
  }

  input {
    width: 100%;
    font-size: var(--step-2);
    padding: var(--space-3) 3.5rem var(--space-3) var(--space-4);
    border: 2px solid var(--ink);
    border-radius: var(--radius);
    background: var(--sheet);
  }

  input::placeholder {
    color: var(--ink-2);
    opacity: 0.8;
  }

  input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }

  input::-webkit-search-cancel-button {
    display: none;
  }

  kbd {
    position: absolute;
    right: var(--space-4);
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }

  input:focus + kbd {
    display: none;
  }
</style>
