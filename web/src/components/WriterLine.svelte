<script lang="ts">
  // "Writes with Claude – mine", and Change: the AI that writes your
  // documents, briefs and prep plans, changed in one click from where you
  // write. The same list as Settings → AI ("The AI in use (Bonsai 2)" first,
  // then every saved AI), saved at once. Change is a menu button, with the
  // AI pill's keys: Enter, Space or the arrows open it, the arrows move,
  // Escape closes it and puts the cursor back on Change.
  import { tick } from 'svelte';
  import { writingAi } from '../../../shared/contracts/index.ts';
  import { aiSummary, writerChoices, writerFallback, writerMessage, writerValue } from '../lib/ai-list.ts';
  import { api } from '../lib/api.ts';
  import { app } from '../lib/app-state.svelte.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  const uid = $props.id();
  const menuId = `${uid}-menu`;

  let open = $state(false);
  // The menu opens upwards when there's no room below the button.
  let up = $state(false);
  let root = $state<HTMLElement>();
  let button = $state<HTMLButtonElement>();
  let menu = $state<HTMLElement>();

  const all = $derived(app.settings.ai);
  const name = $derived(writingAi(all).ai.name);
  const fallback = $derived(writerFallback(all));
  const value = $derived(writerValue(all));
  const choices = $derived(
    writerChoices(all).map((c) => ({ ...c, summary: c.value ? aiSummary(all.saved.find((one) => one.id === c.value)!) : null })),
  );

  const items = (): HTMLElement[] => (menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')] : []);

  // The cursor starts on the AI that writes now.
  async function show(focus: 'checked' | 'last') {
    const box = button?.getBoundingClientRect();
    up = box ? box.bottom + 320 > innerHeight && box.top > 320 : false;
    open = true;
    await tick();
    const list = items();
    const checked = list.find((el) => el.getAttribute('aria-checked') === 'true');
    (focus === 'last' ? list.at(-1) : (checked ?? list[0]))?.focus();
  }

  function hide(o: { focusButton: boolean }) {
    open = false;
    if (o.focusButton) button?.focus();
  }

  function onButtonKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      void show(event.key === 'ArrowUp' ? 'last' : 'checked');
    }
  }

  // A letter moves to the next AI whose name starts with it.
  function typeAhead(list: HTMLElement[], at: number, letter: string) {
    const nameOf = (el: HTMLElement) => (el.querySelector('.name') ?? el).textContent?.trim().toLowerCase() ?? '';
    for (let step = 1; step <= list.length; step++) {
      const el = list[(at + step) % list.length]!;
      if (nameOf(el).startsWith(letter)) {
        el.focus();
        return;
      }
    }
  }

  function onMenuKeydown(event: KeyboardEvent) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => list[(i + list.length) % list.length]?.focus();
    const letter = event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(list.length - 1);
    else if (event.key === 'Escape') hide({ focusButton: true });
    else if (letter) typeAhead(list, at, event.key.toLowerCase());
    else if (event.key === 'Tab') {
      hide({ focusButton: false });
      return;
    } else return;
    // Keys the menu used never reach the page.
    event.preventDefault();
    event.stopPropagation();
  }

  // The focus moving anywhere outside the line closes the menu.
  function onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (open && next && root && !root.contains(next)) hide({ focusButton: false });
  }

  function onWindowPointerDown(event: PointerEvent) {
    if (open && root && !root.contains(event.target as Node)) hide({ focusButton: false });
  }

  async function pick(choice: string) {
    hide({ focusButton: true });
    if (choice === value && !fallback) return;
    const id = choice || null;
    try {
      app.settings = await api.useWriter(id);
      showToast(writerMessage(app.settings.ai, id));
    } catch (err) {
      showToast(friendlyError(err));
    }
    button?.focus();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

{#if app.loaded}
  <div class="writer-line" bind:this={root} onfocusout={onFocusOut}>
    {#if fallback}
      <span class="who missing">{fallback}</span>
    {:else}
      <span class="who">Writes with <strong>{name}</strong></span>
    {/if}
    <button
      type="button"
      class="change"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={menuId}
      aria-label="Change the writing AI"
      bind:this={button}
      onclick={() => (open ? hide({ focusButton: false }) : void show('checked'))}
      onkeydown={onButtonKeydown}
    >
      Change
      <svg class="chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
    </button>

    {#if open}
      <!-- A press inside the menu keeps the focus in it, so the click lands. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="popup off-band" class:up onmousedown={(e) => e.preventDefault()}>
        <div id={menuId} role="menu" tabindex="-1" aria-label="The AI that writes your documents" bind:this={menu} onkeydown={onMenuKeydown}>
          {#each choices as choice (choice.value)}
            {@const checked = choice.value === value}
            <button type="button" role="menuitemradio" aria-checked={checked} class="item" tabindex="-1" onclick={() => pick(choice.value)}>
              <span class="mark" aria-hidden="true">{checked ? '✓' : ''}</span>
              <span class="text">
                <span class="name">{choice.label}</span>
                {#if choice.summary}<span class="summary">{choice.summary}</span>{/if}
              </span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .writer-line {
    position: relative;
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--step--1);
    color: var(--ink-2);
  }

  .who strong {
    color: var(--ink);
  }

  .who.missing {
    color: var(--ink);
    max-width: 40ch;
  }

  /* A small button with a firm edge: 3:1 against the card. */
  .change {
    font: inherit;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0.125rem var(--space-2);
    border: 1px solid var(--edge);
    border-radius: var(--radius);
    background: var(--sheet);
    color: var(--ink);
    cursor: pointer;
  }

  .change:hover {
    border-color: var(--ink-2);
  }

  .chevron {
    width: 0.75em;
    height: 0.75em;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  [aria-expanded='true'] .chevron {
    transform: rotate(180deg);
  }

  /* As the AI pill's menu: the page's colours, on a card under the button. */
  .popup {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    z-index: 20;
    width: min(24rem, calc(100vw - 2rem));
    padding: var(--space-2);
    border: 1px solid var(--edge);
    border-radius: var(--radius);
    background: var(--sheet);
    box-shadow: 0 10px 30px rgb(10 15 30 / 0.28);
    font-size: var(--step-0);
  }

  .popup.up {
    top: auto;
    bottom: calc(100% + var(--space-1));
  }

  [role='menu']:focus {
    outline: none;
  }

  .item {
    font: inherit;
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2);
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }

  .item:hover {
    background: var(--sheet-2);
  }

  .item:focus-visible {
    outline-offset: -3px;
  }

  .mark {
    flex: none;
    width: 1.25rem;
    text-align: center;
    font-weight: 700;
    color: var(--accent);
  }

  .text {
    display: grid;
    min-width: 0;
  }

  .text .name {
    font-weight: 700;
  }

  .summary {
    font-size: var(--step--1);
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
