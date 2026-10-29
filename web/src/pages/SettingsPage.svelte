<script lang="ts">
  // Settings: a menu down the side, and one section at a time beside it.
  // Every section stays on the page while it's hidden, so moving between
  // them never loses what you typed. Each has its own address
  // (/settings#ai), so links, reload and Back land on the right one.
  import { onMount, tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Status } from '../../../shared/contracts/index.ts';
  import AiSettingsSection from '../components/AiSettingsSection.svelte';
  import EmailSettingsSection from '../components/EmailSettingsSection.svelte';
  import ProfileFilesSection from '../components/ProfileFilesSection.svelte';
  import { api } from '../lib/api.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { ai } from '../lib/ai-state.svelte.ts';
  import { app, loadSettings } from '../lib/app-state.svelte.ts';
  import { plural } from '../lib/format.ts';
  import { router } from '../lib/router.svelte.ts';
  import { moveStatus, slugifyStatusId } from '../lib/statuses.ts';
  import { setTheme, storedTheme, type Theme } from '../lib/theme.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  const SECTIONS = [
    { id: 'profile', label: 'Profile' },
    { id: 'ai', label: 'AI' },
    { id: 'email', label: 'Email' },
    { id: 'statuses', label: 'Statuses' },
    { id: 'templates', label: 'Templates' },
    { id: 'display', label: 'Display' },
    { id: 'data', label: 'Your data' },
  ] as const;
  type SectionId = (typeof SECTIONS)[number]['id'];

  const active = $derived<SectionId>(SECTIONS.find((s) => `#${s.id}` === router.hash)?.id ?? 'profile');

  let list = $state<Status[]>([]);
  let saved = $state<string[]>([]);
  let savedList = $state('');
  let newLabel = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let backupMessage = $state<string | null>(null);
  let rebuildMessage = $state<string | null>(null);
  let loaded = $state(false);

  // Sections with changes you haven't saved: the menu says so.
  let unsaved = $state<Record<SectionId, boolean>>({ profile: false, ai: false, email: false, statuses: false, templates: false, display: false, data: false });

  // The theme changes the moment you pick one, so Display never has unsaved changes.
  let theme = $state<Theme>(storedTheme());
  const computerIsDark = new MediaQuery('(prefers-color-scheme: dark)');
  const themes = $derived<{ id: Theme; label: string }[]>([
    { id: 'system', label: `Match this computer (now ${computerIsDark.current ? 'dark' : 'light'})` },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ]);
  $effect(() => {
    unsaved.statuses = loaded && JSON.stringify(list) !== savedList;
  });

  // What the menu says beside each name.
  function noteFor(id: SectionId): { text: string; tone: 'unsaved' | 'bad' | null } | null {
    if (unsaved[id]) return { text: 'Not saved', tone: 'unsaved' };
    // The header pill shows what the AI is doing. The menu only points out a problem.
    if (id === 'ai' && ai.state === 'error') return { text: 'Problem', tone: 'bad' };
    if (id === 'email' && loaded) return { text: app.settings.email.enabled ? 'On' : 'Off', tone: null };
    return null;
  }

  // Edit a private copy, taken once the settings have loaded, so a late
  // load can never wipe out changes you are making.
  function take(statuses: Status[]) {
    list = [...statuses].sort((a, b) => a.order - b.order).map((s) => ({ ...s }));
    saved = list.map((s) => s.id);
    savedList = JSON.stringify(list);
  }

  // A failure to load shows above the menu, whichever section is open.
  onMount(async () => {
    try {
      await loadSettings();
    } catch (err) {
      loadError = friendlyError(err);
      return;
    }
    take(app.settings.statuses);
    loaded = true;
  });

  // Moving to a section puts the cursor on its heading, so a screen reader
  // says where you are. Opening /settings with no section leaves it alone.
  let moved = false;
  $effect(() => {
    const id = active;
    if (!loaded) return;
    if (!moved && !router.hash) {
      moved = true;
      return;
    }
    moved = true;
    void tick().then(() => document.getElementById(`${id}-heading`)?.focus());
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
  {#if loadError}<p class="error" role="alert">{loadError}</p>{/if}

  <div class="layout">
    <nav class="menu" aria-label="Settings sections">
      <ul>
        {#each SECTIONS as section (section.id)}
          {@const note = noteFor(section.id)}
          <li>
            <a
              href="/settings#{section.id}"
              aria-current={active === section.id ? 'page' : undefined}
              aria-label={note ? `${section.label}, ${note.text}` : undefined}
            >
              <span>{section.label}</span>
              {#if note}
                <span class="note" class:unsaved={note.tone === 'unsaved'} class:bad={note.tone === 'bad'}>{note.text}</span>
              {/if}
            </a>
          </li>
        {/each}
      </ul>
    </nav>

    <div class="sheet">
      <ProfileFilesSection
        show={active === 'profile' || active === 'templates' ? active : null}
        bind:unsavedProfile={unsaved.profile}
        bind:unsavedTemplates={unsaved.templates}
      />

      <div hidden={active !== 'ai'}>
        {#if loaded}<AiSettingsSection bind:dirty={unsaved.ai} />{/if}
      </div>

      <div hidden={active !== 'email'}>
        {#if loaded}<EmailSettingsSection bind:dirty={unsaved.email} />{/if}
      </div>

      <section aria-labelledby="statuses-heading" hidden={active !== 'statuses'}>
        <h2 id="statuses-heading" tabindex="-1">Statuses</h2>
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
        {/if}
      </section>

      <section aria-labelledby="display-heading" hidden={active !== 'display'}>
        <h2 id="display-heading" tabindex="-1">Display</h2>
        <fieldset class="themes">
          <legend>Theme</legend>
          {#each themes as option (option.id)}
            <label>
              <input type="radio" name="theme" value={option.id} bind:group={theme} onchange={() => setTheme(theme)} />
              {option.label}
            </label>
          {/each}
        </fieldset>
        <p class="muted">It changes at once, and this browser remembers it.</p>
      </section>

      <section aria-labelledby="data-heading" hidden={active !== 'data'}>
        <h2 id="data-heading" tabindex="-1">Your data</h2>
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
    </div>
  </div>
</main>

<style>
  .layout {
    display: grid;
    grid-template-columns: 12rem minmax(0, 1fr);
    align-items: start;
    margin-top: var(--space-5);
  }

  /* The menu is a row of index-card tabs. The open one is part of the card
     beside it: the same paper, joined through the card's edge, with the
     accent down its spine. */
  .menu {
    position: sticky;
    top: var(--space-4);
    z-index: 1;
  }

  .menu ul {
    list-style: none;
    margin: 0;
    padding: var(--space-4) 0 0;
    display: grid;
    gap: var(--space-1);
  }

  .menu a {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid transparent;
    border-right: 0;
    border-radius: var(--radius) 0 0 var(--radius);
    color: var(--ink-2);
    font-weight: 600;
    text-decoration: none;
  }

  .menu a:hover {
    color: var(--ink);
  }

  .menu a[aria-current='page'] {
    margin-right: -1px;
    padding-right: calc(var(--space-3) + 1px);
    border-color: var(--rule);
    background: var(--sheet);
    color: var(--ink);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .note {
    font-size: var(--step--1);
    font-weight: 400;
    color: var(--ink-2);
    white-space: nowrap;
  }

  .note.unsaved {
    color: var(--accent);
    font-weight: 700;
  }

  .note.bad {
    color: var(--danger);
    font-weight: 700;
  }

  .sheet {
    min-height: 30rem;
    padding: var(--space-5) var(--space-6) var(--space-6);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--sheet);
  }

  /* On a narrow screen the tabs run along the top of the card. */
  @media (max-width: 48rem) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
      margin-top: var(--space-3);
    }

    .menu {
      position: static;
    }

    .menu ul {
      display: flex;
      overflow-x: auto;
      padding: 0 0 var(--space-2);
    }

    .menu a {
      border: 0;
      border-radius: var(--radius);
      white-space: nowrap;
    }

    .menu a[aria-current='page'] {
      margin-right: 0;
      padding-right: var(--space-3);
      box-shadow: inset 0 -3px 0 var(--accent);
    }

    .sheet {
      min-height: 0;
      padding: var(--space-4);
    }
  }

  /* Every section in the card is set out the same way, whichever component it comes from. */
  .sheet :global(section) {
    display: grid;
    gap: var(--space-3);
  }

  .sheet :global(h2) {
    justify-self: start;
    font-size: var(--step-1);
  }

  section {
    justify-items: start;
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

  .themes {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: 0;
  }

  .themes legend {
    padding: 0;
    margin-bottom: var(--space-2);
    font-weight: 600;
  }

  .themes label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
