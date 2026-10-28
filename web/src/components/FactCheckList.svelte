<script lang="ts">
  // "Not in your profile: 40%, Globex": the facts in the draft that your master
  // profile doesn't have. A helper, never a gate: you can still save and send.
  import type { Flag } from '../../../shared/fact-check.ts';

  let { flags, hasProfile }: { flags: Flag[]; hasProfile: boolean } = $props();
</script>

<div class="facts" aria-live="polite">
  {#if !hasProfile}
    <p class="muted">Add your master profile to check facts: <a href="/settings#profile">Settings → Profile</a>.</p>
  {:else if flags.length === 0}
    <p class="muted">No unknown facts found. Still read it yourself.</p>
  {:else}
    <p class="flagged"><strong>Not in your profile:</strong> {flags.map((f) => f.text).join(', ')}</p>
    <p class="muted hint">Check each one before you send. They're highlighted in the preview.</p>
  {/if}
</div>

<style>
  .facts p {
    margin: 0;
  }

  .flagged {
    color: var(--ink);
  }

  .flagged strong {
    color: var(--danger);
  }

  .hint {
    font-size: var(--step--1);
  }
</style>
