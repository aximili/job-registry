<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Status } from '../../../shared/contracts/index.ts';
  import AiSettingsSection from '../components/AiSettingsSection.svelte';
  import { api } from '../lib/api.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { focusAiSettings } from '../lib/ai-state.svelte.ts';
  import { app, loadSettings } from '../lib/app-state.svelte.ts';
  import { plural } from '../lib/format.ts';
  import { moveStatus, slugifyStatusId } from '../lib/statuses.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  let list = $state<Status[]>([]);
  let saved = $state<string[]>([]);
  let newLabel = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);
  let backupMessage = $state<string | null>(null);
  let rebuildMessage = $state<string | null>(null);
  let loaded = $state(false);

  // Edit a private copy, taken once the settings have loaded, so a late
  // load can never wipe out changes you are making.
  function take(statuses: Status[]) {
    list = [...statuses].sort((a, b) => a.order - b.order).map((s) => ({ ...s }));
    saved = list.map((s) => s.id);
  }

  onMount(async () => {
    try {
      await loadSettings();
    } catch (err) {
      error = friendlyError(err);
      return;
    }
    take(app.settings.statuses);
    loaded = true;
    // The AI pill links to /settings#ai.
    if (location.hash === '#ai') {
      await tick();
      focusAiSettings();
    }
  });

  function addStatus() {
    const label = newLabel.trim();
    if (!label) return;
    const id = slugifyStatusId(
      label,
      list.map((s) => s.id),
    );
    // New statuses go before the closed ones.
    const firstClosed = list.findIndex((s) => s.closed);
    const at = firstClosed === -1 ? list.length : firstClosed;
    const next = [...list.slice(0, at), { id, label, closed: false, order: 0, setsAppliedDate: false }, ...list.slice(at)];
    list = next.map((s, i) => ({ ...s, order: (i + 1) * 10 }));
    newLabel = '';
  }

  async function saveStatuses() {
    saving = true;
    error = null;
    try {
      const next = await api.updateSettings({ statuses: list });
      await loadSettings();
      take(next.statuses);
      showToast('Statuses saved.');
    } catch (err) {
      error = friendlyError(err);
    } finally {
      saving = false;
    }
  }

  async function backUp() {
    try {
      const { file } = await api.backupNow();
      backupMessage = `Backed up to ${file}`;
    } catch (err) {
      backupMessage = friendlyError(err);
    }
  }

  async function rebuild() {
    try {
      const res = await api.rebuildSearch();
      rebuildMessage = `Search index rebuilt: ${plural(res.jobs, 'job')}, ${plural(res.contacts, 'contact')}.`;
    } catch (err) {
      rebuildMessage = friendlyError(err);
    }
  }
</script>

<main class="page settings">
  <h1>Settings</h1>

  <section aria-labelledby="statuses-heading">
    <h2 id="statuses-heading">Statuses</h2>
    <p class="muted intro">
      Rename, reorder or add the steps a job goes through. Closed statuses leave the Open list. Each status keeps its id
      for good, so your history stays correct when you rename it.
    </p>
    {#if loaded}
    <table aria-label="Statuses">
      <thead>
        <tr>
          <th scope="col"><span class="visually-hidden">Order</span></th>
          <th scope="col">Label</th>
          <th scope="col">Closed</th>
          <th scope="col">Sets applied date</th>
          <th scope="col">Id</th>
        </tr>
      </thead>
      <tbody>
        {#each list as status, i (status.id)}
          <tr>
            <td class="order">
              <button type="button" class="button quiet" aria-label="Move {status.label} up" disabled={i === 0} onclick={() => (list = moveStatus(list, status.id, -1))}>↑</button>
              <button type="button" class="button quiet" aria-label="Move {status.label} down" disabled={i === list.length - 1} onclick={() => (list = moveStatus(list, status.id, 1))}>↓</button>
            </td>
            <td><input aria-label="Label for {status.id}" bind:value={status.label} /></td>
            <td><input type="checkbox" aria-label="Closed: {status.label}" bind:checked={status.closed} /></td>
            <td><input type="checkbox" aria-label="Sets applied date: {status.label}" bind:checked={status.setsAppliedDate} /></td>
            <td class="muted id">{status.id}{saved.includes(status.id) ? '' : ' (new)'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <form
      class="add"
      onsubmit={(e) => {
        e.preventDefault();
        addStatus();
      }}
    >
      <label class="field"><span>New status</span><input bind:value={newLabel} placeholder="For example, Phone screen" /></label>
      <button type="submit" class="button" disabled={!newLabel.trim()}>Add status</button>
    </form>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button type="button" class="button primary" disabled={saving} onclick={saveStatuses}>Save statuses</button>
    {:else if error}
      <p class="error" role="alert">{error}</p>
    {/if}
  </section>

  {#if loaded}<AiSettingsSection />{/if}

  <section aria-labelledby="data-heading">
    <h2 id="data-heading">Your data</h2>
    <p class="muted intro">
      Everything is stored on this computer. A backup is made each time the app starts and once a day while it runs.
    </p>
    <div class="row">
      <button type="button" class="button" onclick={backUp}>Back up now</button>
      {#if backupMessage}<p>{backupMessage}</p>{/if}
    </div>
    <div class="row">
      <button type="button" class="button" onclick={rebuild}>Rebuild search index</button>
      {#if rebuildMessage}<p>{rebuildMessage}</p>{/if}
    </div>
  </section>
</main>

<style>
  .settings {
    display: grid;
    gap: var(--space-6);
    max-width: 52rem;
  }

  section {
    display: grid;
    gap: var(--space-3);
    justify-items: start;
  }

  h2 {
    font-size: var(--step-1);
  }

  .intro {
    max-width: 65ch;
  }

  table {
    border-collapse: collapse;
    width: 100%;
  }

  th {
    text-align: left;
    font-size: var(--step--1);
    color: var(--ink-2);
    font-weight: 600;
    padding: var(--space-1) var(--space-2);
  }

  td {
    padding: var(--space-1) var(--space-2);
    border-top: 1px solid var(--rule);
  }

  .order {
    white-space: nowrap;
  }

  .order .button {
    padding: var(--space-1) var(--space-2);
  }

  .id {
    font-size: var(--step--1);
  }

  .add {
    display: flex;
    align-items: end;
    gap: var(--space-2);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
</style>
