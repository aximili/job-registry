<script lang="ts">
  // The small panel in the corner of Seek, LinkedIn and Indeed job pages. It
  // lives in a closed shadow root, so the site's styles can't change it.
  import { tick } from 'svelte';
  import { DEFAULT_PLACE, fit, moved, resized, type Box, type Edge, type PanelPlace, type Size } from './place.ts';
  import { likelyText, ratingText, savedText } from './text.ts';
  import type { PanelActions, PanelView } from './types.ts';

  let { actions }: { actions: PanelActions } = $props();

  // The content script sets the real view straight after mounting.
  let view = $state<PanelView>({ state: { kind: 'loading' }, rating: { kind: 'off' }, minimised: false, place: DEFAULT_PLACE, job: null, jobKey: null });
  let status = $state('saved');
  let note = $state('');
  let toggleButton = $state<HTMLButtonElement>();
  let panel = $state<HTMLDivElement>();

  // Moving and resizing. While you drag, the panel follows the pointer;
  // letting go keeps the new place for every page.
  const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  // Raw, not a Svelte proxy: it goes to the browser's storage, and Firefox
  // can't store a proxy.
  let dragging = $state.raw<PanelPlace | null>(null);
  let drag: { kind: 'move' | Edge; x: number; y: number; box: Box; from: PanelPlace } | null = null;
  let width = $state(0);
  let height = $state(0);
  let windowSize = $state<Size>(windowNow());
  const place = $derived(dragging ?? view.place);
  // Kept inside the window, however small it gets or tall the panel grows.
  const shown = $derived(fit(place, { width, height }, windowSize));

  // The part of the window a fixed box can use (without the scroll bars).
  function windowNow(): Size {
    const root = document.documentElement;
    return { width: root.clientWidth, height: root.clientHeight };
  }

  function startDrag(event: PointerEvent, kind: 'move' | Edge) {
    if (event.button !== 0 || !panel) return;
    if (kind === 'move' && (event.target as Element).closest('button')) return;
    // No text selected on the page, and no focus moved, while you drag.
    event.preventDefault();
    const r = panel.getBoundingClientRect();
    drag = { kind, x: event.clientX, y: event.clientY, box: { left: r.left, top: r.top, width: r.width, height: r.height }, from: place };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  }

  function onDrag(event: PointerEvent) {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const size = windowNow();
    dragging = drag.kind === 'move' ? moved(drag.box, dx, dy, size, drag.from) : resized(drag.box, drag.kind, dx, dy, size, drag.from);
  }

  function endDrag() {
    const done = dragging;
    drag = null;
    dragging = null;
    if (done) actions.setPlace(done);
  }

  // A double-click on the bar puts the panel back in its corner, at its usual size.
  function putBack(event: MouseEvent) {
    if ((event.target as Element).closest('button')) return;
    actions.setPlace(DEFAULT_PLACE);
  }

  export function setView(next: PanelView) {
    // A different job starts with a fresh status and note; the same job
    // (say, more of its ad just arrived) keeps what you chose.
    if (next.jobKey !== view.jobKey) {
      status = 'saved';
      note = '';
    }
    view = next;
  }

  // After Esc, the cursor goes to Show rather than back to the page.
  export async function focusToggle() {
    await tick();
    toggleButton?.focus();
  }

  const now = () => new Date();

  function toggle() {
    actions.setMinimised(!view.minimised);
  }
</script>

{#snippet form()}
  <label>
    <span>Status</span>
    <select bind:value={status}>
      <option value="saved">Saved</option>
      <option value="applied">Applied</option>
    </select>
  </label>
  <label>
    <span>Note</span>
    <textarea bind:value={note} rows="2" placeholder="Optional"></textarea>
  </label>
{/snippet}

<svelte:window onresize={() => (windowSize = windowNow())} />

<div
  class="panel"
  class:min={view.minimised}
  role="complementary"
  aria-label="Job Registry"
  bind:this={panel}
  bind:offsetWidth={width}
  bind:offsetHeight={height}
  style:right="{shown.right}px"
  style:bottom="{shown.bottom}px"
  style:width={!view.minimised && place.width !== null ? `${place.width}px` : null}
  style:height={!view.minimised && place.height !== null ? `${place.height}px` : null}
  style:max-height={!view.minimised && place.height !== null ? '100vh' : null}
>
  <!-- Dragging is for the mouse; the panel works the same where it starts. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="bar" onpointerdown={(e) => startDrag(e, 'move')} onpointermove={onDrag} onpointerup={endDrag} onpointercancel={endDrag} ondblclick={putBack}>
    <span class="brand" title="Drag to move. Double-click to put it back in the corner.">Job Registry</span>
    <button type="button" class="quiet" bind:this={toggleButton} aria-expanded={!view.minimised} onclick={toggle}>{view.minimised ? 'Show' : 'Hide'}</button>
  </div>

  {#if !view.minimised}
    <div class="body">
      {#if view.job?.title}
        <p class="job">{[view.job.title, view.job.company].filter(Boolean).join(' · ')}</p>
      {/if}
      {#if view.state.kind === 'loading'}
        <p role="status">Checking Job Registry…</p>
      {:else if view.state.kind === 'offline'}
        <p role="status">Job Registry isn't running. Start it, then press Try again.</p>
        <button type="button" onclick={actions.retry}>Try again</button>
      {:else if view.state.kind === 'unreadable'}
        <p>Couldn't read this job. Select the ad text and press Save selection, or save the whole page.</p>
        <div class="row">
          <button type="button" onclick={actions.saveSelection}>Save selection</button>
          <button type="button" onclick={actions.savePage}>Save page</button>
        </div>
        {#if view.state.error}<p class="error" role="alert">{view.state.error}</p>{/if}
      {:else if view.state.kind === 'saved'}
        {@const saved = view.state}
        <p class="saved" role="status">{savedText(saved, now())}</p>
        <button type="button" onclick={() => actions.open(saved.jobId)}>Open in Job Registry</button>
      {:else if view.state.kind === 'likely'}
        {@const likely = view.state}
        {#each likely.candidates as candidate (candidate.jobId)}
          <div class="candidate">
            <p>{likelyText(candidate, now())}</p>
            <button type="button" class="primary" disabled={likely.saving} onclick={() => actions.same(candidate.jobId, status, note)}>Same job</button>
          </div>
        {/each}
        {@render form()}
        <button type="button" disabled={likely.saving} onclick={() => actions.different(status, note)}>Different job</button>
        {#if likely.error}<p class="error" role="alert">{likely.error}</p>{/if}
      {:else if view.state.kind === 'new'}
        {@const fresh = view.state}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            actions.save(status, note);
          }}
        >
          {@render form()}
          <button type="submit" class="primary" disabled={fresh.saving}>{fresh.saving ? 'Saving…' : 'Save'}</button>
        </form>
        {#if fresh.error}<p class="error" role="alert">{fresh.error}</p>{/if}
      {:else if view.state.kind === 'error'}
        <p class="error" role="alert">{view.state.message}</p>
        <button type="button" onclick={actions.retry}>Try again</button>
      {/if}

      {#if view.rating.kind !== 'off'}
        <div class="rating" aria-live="polite">
          {#if view.rating.kind === 'pending'}
            <p class="muted">Rating…</p>
          {:else if view.rating.kind === 'done'}
            {@const r = view.rating.rating}
            <p class="verdict {r.verdict}">{ratingText(r)}</p>
            {#if r.why.length > 0}
              <p class="label" id="jr-why">Why it fits</p>
              <ul aria-labelledby="jr-why">{#each r.why as reason, i (i)}<li>{reason}</li>{/each}</ul>
            {/if}
            {#if r.whyNot.length > 0}
              <p class="label" id="jr-why-not">Why it might not</p>
              <ul aria-labelledby="jr-why-not">{#each r.whyNot as reason, i (i)}<li>{reason}</li>{/each}</ul>
            {/if}
            {#if r.dealBreakers.length > 0}
              <p class="label bad" id="jr-deal">Deal-breakers</p>
              <ul class="bad" aria-labelledby="jr-deal">{#each r.dealBreakers as reason, i (i)}<li>{reason}</li>{/each}</ul>
            {/if}
          {:else if view.rating.kind === 'none'}
            <p class="muted">{view.rating.reason}</p>
          {:else if view.rating.kind === 'error'}
            <p class="muted">No rating: {view.rating.message}</p>
          {/if}
        </div>
      {/if}
    </div>
    {#each EDGES as edge (edge)}
      <div class="grip {edge}" aria-hidden="true" onpointerdown={(e) => startDrag(e, edge)} onpointermove={onDrag} onpointerup={endDrag} onpointercancel={endDrag}></div>
    {/each}
  {/if}
</div>

<style>
  .panel {
    --ink: #1b2330;
    --ink-2: #4e5a6a;
    --paper: #ffffff;
    --rule: #d8dde5;
    --accent: #2b44d1;
    --danger: #b3261e;
    --ok: #1a7f37;
    position: fixed;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 320px;
    max-width: 100vw;
    max-height: min(70vh, 560px);
    background: var(--paper);
    color: var(--ink);
    border: 1px solid var(--rule);
    border-radius: 10px;
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.18);
    font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    text-align: left;
  }

  @media (prefers-color-scheme: dark) {
    .panel {
      --ink: #e6e9ef;
      --ink-2: #9aa6b6;
      --paper: #161b24;
      --rule: #2c3442;
      --accent: #8ea2ff;
      --accent-ink: #0d1330;
      --danger: #ff8a80;
      --ok: #6fd58a;
    }
  }

  .panel.min {
    width: auto;
  }

  /* The bar stays in view while the rest scrolls, and is what you drag. */
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--rule);
    cursor: move;
    user-select: none;
    touch-action: none;
  }

  .min .bar {
    border-bottom: none;
  }

  .brand {
    font-weight: 700;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 12px;
    display: grid;
    align-content: start;
    gap: 10px;
  }

  /* Thin strips along each edge, and squares at the corners, for resizing. */
  .grip {
    position: absolute;
    touch-action: none;
  }

  .grip.n,
  .grip.s {
    left: 8px;
    right: 8px;
    height: 6px;
    cursor: ns-resize;
  }

  .grip.e,
  .grip.w {
    top: 8px;
    bottom: 8px;
    width: 6px;
    cursor: ew-resize;
  }

  .grip.ne,
  .grip.nw,
  .grip.se,
  .grip.sw {
    width: 12px;
    height: 12px;
  }

  .grip.n,
  .grip.ne,
  .grip.nw {
    top: -3px;
  }

  .grip.s,
  .grip.se,
  .grip.sw {
    bottom: -3px;
  }

  .grip.e,
  .grip.ne,
  .grip.se {
    right: -3px;
  }

  .grip.w,
  .grip.nw,
  .grip.sw {
    left: -3px;
  }

  .grip.nw,
  .grip.se {
    cursor: nwse-resize;
  }

  .grip.ne,
  .grip.sw {
    cursor: nesw-resize;
  }

  p {
    margin: 0;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  form {
    display: grid;
    gap: 8px;
  }

  label {
    display: grid;
    gap: 2px;
    font-size: 12px;
    color: var(--ink-2);
  }

  select,
  textarea {
    font: inherit;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 6px;
    padding: 4px 6px;
  }

  button {
    font: inherit;
    color: var(--ink);
    background: transparent;
    border: 1px solid var(--rule);
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;
  }

  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink, #fff);
  }

  button.quiet {
    border-color: transparent;
    color: var(--ink-2);
  }

  button:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .saved {
    font-weight: 600;
  }

  .job {
    color: var(--ink-2);
    font-size: 12px;
  }

  .candidate {
    display: grid;
    gap: 6px;
  }

  .rating {
    border-top: 1px solid var(--rule);
    padding-top: 10px;
    display: grid;
    gap: 4px;
  }

  .verdict {
    font-weight: 700;
    font-size: 15px;
  }

  .verdict.strong,
  .verdict.good {
    color: var(--ok);
  }

  .verdict.weak {
    color: var(--danger);
  }

  .label {
    font-size: 12px;
    color: var(--ink-2);
    margin-top: 4px;
  }

  ul {
    margin: 0;
    padding-left: 1.1em;
  }

  .bad {
    color: var(--danger);
  }

  .muted {
    color: var(--ink-2);
  }

  .error {
    color: var(--danger);
  }
</style>
