<script lang="ts">
  import { findStatus, statusLabel } from '../lib/app-state.svelte.ts';

  let { status }: { status: string } = $props();

  // Closed statuses are grey; an offer is green; everything else in progress uses the accent.
  const tone = $derived(findStatus(status)?.closed ? 'closed' : status === 'offer' || status === 'accepted' ? 'good' : 'open');
</script>

<span class="status" data-tone={tone}>{statusLabel(status)}</span>
