<script lang="ts">
  // The small panel in the corner of Seek, LinkedIn and Indeed job pages. It
  // lives in a closed shadow root, so the site's styles can't change it.
  import { tick } from 'svelte';
  import { likelyText, ratingText, savedText } from './text.ts';
  import type { PanelActions, PanelView } from './types.ts';

  let { actions }: { actions: PanelActions } = $props();

  // The content script sets the real view straight after mounting.
  let view = $state<PanelView>({ state: { kind: 'loading' }, rating: { kind: 'off' }, minimised: false, job: null, jobKey: null });
  let status = $state('saved');
  let note = $state('');
  let toggleButton = $state<HTMLButtonElement>();

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

<div class="panel" class:min={view.minimised} role="complementary" aria-label="Job Registry">
  <div class="bar">
    <span class="brand">Job Registry</span>
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
    box-sizing: border-box;
    width: 320px;
    max-height: min(70vh, 560px);
    overflow: auto;
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

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--rule);
  }

  .min .bar {
    border-bottom: none;
  }

  .brand {
    font-weight: 700;
  }

  .body {
    padding: 12px;
    display: grid;
    gap: 10px;
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
