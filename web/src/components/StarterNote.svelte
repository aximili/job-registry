<script lang="ts">
  // Settings → Profile: a newer starter guide is ready. See what it changes
  // (your guide against the new one, its unchanged runs folded), then use it
  // or keep yours, one click each.
  import { SvelteSet } from 'svelte/reactivity';
  import type { DiffLine, StarterStatus } from '../../../shared/contracts/index.ts';
  import { foldDiff } from '../lib/starter-diff.ts';

  let {
    status,
    label,
    busy,
    error,
    onuse,
    onkeep,
  }: { status: StarterStatus; label: string; busy: boolean; error: string | null; onuse: () => void; onkeep: () => void } = $props();

  const id = $derived(`starter-${status.name}`);
  let open = $state(false);
  // The folds you've opened, by their place in the parts.
  const opened = new SvelteSet<number>();
  const parts = $derived(foldDiff(status.diff ?? []));
  let diffEl = $state<HTMLElement>();

  // The fold's button goes once it's open: focus stays in the diff, so Tab
  // goes on from there.
  function unfold(i: number) {
    opened.add(i);
    diffEl?.focus({ preventScroll: true });
  }

  // Told apart by more than colour: a sign you see, and a word a screen reader says.
  const SIGN = { same: ' ', removed: '−', added: '+' } as const;
  const WORD = { same: '', removed: 'Removed: ', added: 'Added: ' } as const;
  const unchanged = (n: number) => (n === 1 ? 'Show 1 unchanged line' : `Show ${n} unchanged lines`);
</script>

{#snippet line(l: DiffLine)}
  <div class="line {l.kind}">
    <span class="sign" aria-hidden="true">{SIGN[l.kind]}</span>
    <span class="text">{#if WORD[l.kind]}<span class="visually-hidden">{WORD[l.kind]}</span>{/if}{l.text || ' '}</span>
  </div>
{/snippet}

<section class="starter" aria-labelledby="{id}-label {id}-title">
  <div class="head">
    <p id="{id}-label" class="label">{label}</p>
    <p id="{id}-title" class="title">A newer starter guide is ready.</p>
    <button type="button" class="button quiet see" aria-expanded={open} aria-controls="{id}-diff" onclick={() => (open = !open)}>
      See what changes <span aria-hidden="true">{open ? '▴' : '▾'}</span>
    </button>
  </div>

  <div bind:this={diffEl} id="{id}-diff" class="diff" role="group" tabindex="-1" aria-label="What changes in your {label.toLowerCase()}" hidden={!open}>
    <p class="legend muted" aria-hidden="true">
      <span><span class="sign removed">−</span> taken out of yours</span>
      <span><span class="sign added">+</span> added by the new guide</span>
    </p>
    {#each parts as part, i (i)}
      {#if part.kind === 'line'}
        {@render line(part.line)}
      {:else if opened.has(i)}
        {#each part.lines as l, k (k)}{@render line(l)}{/each}
      {:else}
        <button type="button" class="fold" onclick={() => unfold(i)}>{unchanged(part.lines.length)}</button>
      {/if}
    {/each}
  </div>

  <div class="actions">
    <button type="button" class="button primary" disabled={busy} onclick={onuse}>Use the new guide</button>
    <button type="button" class="button" disabled={busy} onclick={onkeep}>Keep mine</button>
    {#if error}<span class="error" role="alert">{error}</span>{/if}
  </div>
</section>

<style>
  .starter {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--rule);
    border-left: 4px solid var(--accent);
    border-radius: var(--radius);
    background: var(--accent-soft);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--space-3);
  }

  .label {
    flex-basis: 100%;
    font-size: var(--step--1);
    font-weight: 600;
    color: var(--ink-2);
  }

  .title {
    font-weight: 700;
    font-size: var(--step-1);
  }

  .see {
    padding-inline: var(--space-2);
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .diff {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: var(--step--1);
    line-height: 1.45;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--sheet);
    overflow: hidden;
  }

  /* On the diff's own plain background, so its signs keep their contrast. */
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    padding: var(--space-1) var(--space-3) var(--space-1) 1.75rem;
    font-family: var(--font);
    border-bottom: 1px solid var(--rule);
  }

  .line {
    display: grid;
    grid-template-columns: 1.75rem 1fr;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .line .text {
    padding-right: var(--space-3);
  }

  .sign {
    text-align: center;
    font-weight: 700;
    user-select: none;
  }

  .line.removed {
    background: color-mix(in srgb, var(--danger) 12%, var(--sheet));
  }

  .line.added {
    background: color-mix(in srgb, var(--good) 10%, var(--sheet));
  }

  .sign.removed,
  .line.removed .sign {
    color: var(--danger);
  }

  .sign.added,
  .line.added .sign {
    color: var(--good);
  }

  .line.same .text {
    color: var(--ink-2);
  }

  .fold {
    display: block;
    width: 100%;
    font: inherit;
    font-family: var(--font);
    text-align: left;
    padding: var(--space-1) var(--space-3) var(--space-1) 1.75rem;
    border: 0;
    border-block: 1px dashed var(--rule);
    background: var(--sheet-2);
    color: var(--ink-2);
    cursor: pointer;
  }

  .fold:hover {
    color: var(--ink);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
</style>
