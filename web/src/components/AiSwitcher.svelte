<script lang="ts">
  // The AI pill in the header: the AI in use and what it's doing. One click
  // opens your saved AIs, this computer's first, then the cloud's; picking
  // one switches the whole app to it at once. A menu button: Enter, Space or
  // the arrows open it, the arrows move, Escape closes it and puts the
  // cursor back on the button.
  import { onMount, tick } from 'svelte';
  import { AI_PRESETS, type SavedAi } from '../../../shared/contracts/index.ts';
  import { aiSummary, noKeyYet } from '../lib/ai-list.ts';
  import {
    AI_LABEL,
    AI_STATE_WORD,
    ai,
    aiInUseName,
    aiKeys,
    focusAiSettings,
    refreshAiKeys,
    switchAi,
    watchAi,
  } from '../lib/ai-state.svelte.ts';
  import { app } from '../lib/app-state.svelte.ts';
  import { navigate, router } from '../lib/router.svelte.ts';

  onMount(() => watchAi());

  let open = $state(false);
  let root = $state<HTMLElement>();
  let button = $state<HTMLButtonElement>();
  let menu = $state<HTMLElement>();

  const activeId = $derived(app.settings.ai.active);
  // null until the status or the settings say which AI is in use.
  const name = $derived(aiInUseName());
  const problem = $derived(ai.state === 'error' ? (ai.detail ?? 'The AI had a problem.') : null);
  const title = $derived(problem ?? (ai.state === 'off' ? "The AI starts when it's needed." : AI_LABEL[ai.state]));
  // Its name starts with what it shows ("Bonsai 2 · ready"), for speech input.
  const label = $derived(name === null ? 'AI' : `${name}, ${AI_STATE_WORD[ai.state]}, AI in use`);

  // This computer first, then the cloud, each in the order you saved them.
  // None until the settings have loaded.
  const groups = $derived.by(() => {
    const saved = app.loaded ? app.settings.ai.saved : [];
    return [
      { label: 'On this computer', list: saved.filter((one) => AI_PRESETS[one.preset].group === 'local') },
      { label: 'Cloud', list: saved.filter((one) => AI_PRESETS[one.preset].group === 'cloud') },
    ].filter((group) => group.list.length > 0);
  });

  const items = (): HTMLElement[] => (menu ? [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')] : []);

  // The cursor starts on the AI in use, so its neighbour is one arrow away.
  // Which AIs have a key is asked again, in case a live event was missed.
  async function show(focus: 'checked' | 'last') {
    open = true;
    void refreshAiKeys();
    await tick();
    const all = items();
    const checked = all.find((el) => el.getAttribute('aria-checked') === 'true');
    (focus === 'last' ? all.at(-1) : (checked ?? all[0]))?.focus();
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

  // A letter moves to the next item whose name starts with it.
  function typeAhead(all: HTMLElement[], at: number, letter: string) {
    const nameOf = (el: HTMLElement) => (el.querySelector('.name') ?? el).textContent?.trim().toLowerCase() ?? '';
    for (let step = 1; step <= all.length; step++) {
      const el = all[(at + step) % all.length]!;
      if (nameOf(el).startsWith(letter)) {
        el.focus();
        return;
      }
    }
  }

  function onMenuKeydown(event: KeyboardEvent) {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => all[(i + all.length) % all.length]?.focus();
    const letter = event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(all.length - 1);
    else if (event.key === 'Escape') hide({ focusButton: true });
    else if (letter) typeAhead(all, at, event.key.toLowerCase());
    else if (event.key === 'Tab') {
      hide({ focusButton: false });
      return;
    } else return;
    // Keys the menu used never reach the page: Escape there goes back, N
    // opens a new job, / jumps to search.
    event.preventDefault();
    event.stopPropagation();
  }

  // The focus moving anywhere outside the switcher closes the menu.
  function onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (open && next && root && !root.contains(next)) hide({ focusButton: false });
  }

  async function pick(one: SavedAi) {
    hide({ focusButton: true });
    await switchAi(one.id);
    button?.focus();
  }

  // Already on Settings: open its AI section and move there, even when it's
  // the one already open.
  function manage(event: MouseEvent) {
    event.preventDefault();
    hide({ focusButton: false });
    navigate('/settings#ai');
    if (router.route.name === 'settings') void tick().then(focusAiSettings);
  }

  function onWindowPointerDown(event: PointerEvent) {
    if (open && root && !root.contains(event.target as Node)) hide({ focusButton: false });
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="switcher" bind:this={root} onfocusout={onFocusOut}>
  <button
    type="button"
    class="trigger {ai.state}"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls="ai-switcher-menu"
    aria-label={label}
    {title}
    bind:this={button}
    onclick={() => (open ? hide({ focusButton: false }) : void show('checked'))}
    onkeydown={onButtonKeydown}
  >
    <span class="dot"></span>
    {#if name === null}
      <span class="name">AI</span>
    {:else}
      <span class="name">{name}</span>
      <span class="state">· {AI_STATE_WORD[ai.state]}</span>
    {/if}
    <svg class="chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
  </button>

  {#if open}
    <!-- A press inside the menu keeps the focus in it, so the click lands. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="popup off-band" onmousedown={(e) => e.preventDefault()}>
      {#if problem}<p class="problem" id="ai-switcher-problem">{problem}</p>{/if}
      <div
        id="ai-switcher-menu"
        role="menu"
        tabindex="-1"
        aria-label="Switch the AI"
        aria-describedby={problem ? 'ai-switcher-problem' : undefined}
        bind:this={menu}
        onkeydown={onMenuKeydown}
      >
        {#each groups as group (group.label)}
          <div role="group" aria-label={group.label} class="group">
            <p class="group-label" aria-hidden="true">{group.label}</p>
            {#each group.list as one (one.id)}
              {@const inUse = one.id === activeId}
              <button type="button" role="menuitemradio" aria-checked={inUse} class="item" tabindex="-1" onclick={() => pick(one)}>
                <span class="mark" aria-hidden="true">{inUse ? '✓' : ''}</span>
                <span class="text">
                  <span class="name">{one.name}</span>
                  <span class="summary">{aiSummary(one)}</span>
                  {#if noKeyYet(one, aiKeys.ids)}<span class="no-key">No API key yet</span>{/if}
                </span>
              </button>
            {/each}
          </div>
        {/each}
        <div role="separator" class="separator"></div>
        <a href="/settings#ai" role="menuitem" tabindex="-1" class="item manage" onclick={manage}>Manage AIs…</a>
      </div>
    </div>
  {/if}
</div>

<style>
  .switcher {
    position: relative;
  }

  /* A pill on the band: its edge is half-white, 4.5:1 against the band. */
  .trigger {
    font: inherit;
    font-size: var(--step--1);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border: 1px solid color-mix(in srgb, var(--ink) 50%, transparent);
    border-radius: 999px;
    color: var(--ink);
    background: transparent;
    cursor: pointer;
    white-space: nowrap;
  }

  .trigger:hover {
    border-color: var(--ink-2);
  }

  .trigger .name {
    font-weight: 700;
  }

  .trigger .state {
    color: var(--ink-2);
  }

  .trigger.error {
    border-color: var(--danger);
  }

  .trigger.error .state {
    color: var(--danger);
    font-weight: 700;
  }

  .dot {
    flex: none;
    width: 0.6em;
    height: 0.6em;
    border-radius: 50%;
    background: var(--ink-2);
  }

  .ready .dot {
    background: var(--ok);
  }

  .starting .dot,
  .busy .dot {
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite alternate;
  }

  .error .dot {
    background: var(--danger);
  }

  .off .dot {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--ink-2);
  }

  .chevron {
    width: 0.75em;
    height: 0.75em;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  [aria-expanded='true'] .chevron {
    transform: rotate(180deg);
  }

  /* The menu: the page's own colours, on a card that drops from the pill. */
  .popup {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    z-index: 20;
    width: min(28rem, calc(100vw - 2rem));
    padding: var(--space-2);
    border: 1px solid var(--edge);
    border-radius: var(--radius);
    background: var(--sheet);
    box-shadow: 0 10px 30px rgb(10 15 30 / 0.28);
  }

  [role='menu']:focus {
    outline: none;
  }

  .problem {
    margin: 0 0 var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-left: 3px solid var(--danger);
    border-radius: 0 var(--radius) var(--radius) 0;
    background: var(--sheet-2);
    color: var(--danger);
    font-weight: 600;
  }

  .group + .group {
    margin-top: var(--space-2);
  }

  /* In line with the names below it, past the tick's column. */
  .group-label {
    margin: 0;
    padding: var(--space-1) var(--space-2) var(--space-1) calc(var(--space-2) + 1.25rem + var(--space-2));
    font-size: var(--step--1);
    font-weight: 700;
    color: var(--ink-2);
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
    text-decoration: none;
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
    flex: 1;
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

  /* As in Settings → AI's list. */
  .no-key {
    font-size: var(--step--1);
    font-weight: 700;
    color: var(--danger);
  }

  .separator {
    height: 1px;
    margin: var(--space-2) 0;
    background: var(--rule);
  }

  .manage {
    font-weight: 600;
    padding-left: calc(var(--space-2) + 1.25rem + var(--space-2));
  }

  @keyframes pulse {
    to {
      opacity: 0.25;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .starting .dot,
    .busy .dot {
      animation: none;
    }
  }
</style>
