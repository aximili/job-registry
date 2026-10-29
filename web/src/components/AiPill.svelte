<script lang="ts">
  // A small pill in the header that shows what the AI is doing. It links to
  // the AI settings, where you can test the connection.
  import { onMount } from 'svelte';
  import { tick } from 'svelte';
  import { AI_LABEL, ai, focusAiSettings, watchAi } from '../lib/ai-state.svelte.ts';
  import { navigate, router } from '../lib/router.svelte.ts';

  onMount(() => watchAi());

  const title = $derived(ai.state === 'error' ? (ai.detail ?? 'The AI had a problem.') : ai.state === 'off' ? "The AI starts when it's needed." : AI_LABEL[ai.state]);

  // Already on Settings: open its AI section and move there, even when it's
  // the one already open.
  function onclick(event: MouseEvent) {
    if (router.route.name !== 'settings') return;
    event.preventDefault();
    navigate('/settings#ai');
    void tick().then(focusAiSettings);
  }
</script>

<a href="/settings#ai" class="pill {ai.state}" {title} {onclick}>{AI_LABEL[ai.state]}</a>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-radius: 999px;
    border: 1px solid var(--rule);
    font-size: var(--step--1);
    text-decoration: none;
    color: var(--ink-2);
    white-space: nowrap;
  }

  .pill::before {
    content: '';
    width: 0.55em;
    height: 0.55em;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.6;
  }

  .ready {
    color: var(--ok);
  }

  .starting,
  .busy {
    color: var(--accent);
  }

  .busy::before,
  .starting::before {
    animation: pulse 1s ease-in-out infinite alternate;
  }

  .error {
    color: var(--danger);
    border-color: var(--danger);
  }

  @keyframes pulse {
    to {
      opacity: 0.15;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .busy::before,
    .starting::before {
      animation: none;
    }
  }
</style>
