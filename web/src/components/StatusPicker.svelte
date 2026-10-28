<script lang="ts">
  // Changing status with the keyboard. On Windows, arrow keys change a closed
  // list straight away and fire a change for every step. So a keyboard choice
  // waits until you stop (or press Enter, or leave the list), and records one
  // change. A mouse pick saves at once. Esc puts the old status back. After
  // saving, the list lets go of the keyboard, so L, E and Esc work again.
  import { findStatus, statuses } from '../lib/app-state.svelte.ts';

  let { status, onChange }: { status: string; onChange: (status: string) => void } = $props();

  const SETTLE_MS = 1200;
  let select: HTMLSelectElement;
  let pending = $state('');
  let sent: string | null = null;
  let byPointer = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    pending = status;
    sent = null;
  });

  function commit() {
    clearTimeout(timer);
    if (pending !== status && pending !== sent) {
      sent = pending;
      onChange(pending);
    }
    if (document.activeElement === select) select.blur();
  }

  function onSelectChange(event: Event & { currentTarget: HTMLSelectElement }) {
    pending = event.currentTarget.value;
    clearTimeout(timer);
    if (byPointer) {
      byPointer = false;
      commit();
    } else {
      timer = setTimeout(commit, SETTLE_MS);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(timer);
      pending = status;
      select.value = status;
      select.blur();
    }
  }

  function onBlur() {
    if (pending !== status) commit();
  }
</script>

<label class="picker">
  <span>Status</span>
  <select
    id="status-picker"
    bind:this={select}
    value={pending}
    onchange={onSelectChange}
    onkeydown={onKeydown}
    onblur={onBlur}
    onpointerdown={() => (byPointer = true)}
  >
    {#if !findStatus(status)}
      <option value={status}>{status}</option>
    {/if}
    {#each statuses() as s (s.id)}
      <option value={s.id}>{s.label}</option>
    {/each}
  </select>
  <kbd aria-hidden="true">S</kbd>
</label>

<style>
  .picker {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--step--1);
    color: var(--ink-2);
  }

  select {
    font-weight: 600;
    color: var(--ink);
  }
</style>
