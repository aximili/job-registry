<script lang="ts">
  import type { Note } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { formatRelative } from '../lib/format.ts';

  let { jobId, notes, onSaved }: { jobId: number; notes: Note[]; onSaved: () => void } = $props();

  const SHOWN = 3;
  // An unsaved note is kept for this browser tab, so jumping to search
  // (or reloading) mid-sentence doesn't lose it. The job page is rebuilt for
  // each job, so the key is read when the panel is created.
  const draftKey = () => `jr-note-draft-${jobId}`;
  let draft = $state(sessionStorage.getItem(draftKey()) ?? '');
  $effect(() => {
    if (draft) sessionStorage.setItem(draftKey(), draft);
    else sessionStorage.removeItem(draftKey());
  });
  let saving = $state(false);
  let error = $state<string | null>(null);
  let showAll = $state(false);

  const visible = $derived(showAll ? notes : notes.slice(0, SHOWN));

  async function save() {
    if (!draft.trim() || saving) return;
    saving = true;
    try {
      await api.addNote(jobId, draft);
      draft = '';
      error = null;
      onSaved();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void save();
    }
  }
</script>

<section aria-labelledby="notes-heading" class="panel">
  <div class="panel-head">
    <h2 id="notes-heading">Notes</h2>
  </div>
  <textarea
    aria-label="Add a note"
    placeholder="Add a note. Ctrl+Enter saves."
    rows="2"
    bind:value={draft}
    onkeydown={onKeydown}
  ></textarea>
  {#if draft.trim()}
    <div class="actions">
      <button type="button" class="button primary" disabled={saving} onclick={save}>Save note</button>
    </div>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
  <ul>
    {#each visible as note (note.id)}
      <li>
        <p class="body">{note.body}</p>
        <span class="muted small">{formatRelative(note.createdAt)}</span>
      </li>
    {/each}
  </ul>
  {#if notes.length > SHOWN}
    <button type="button" class="button quiet" onclick={() => (showAll = !showAll)}>
      {showAll ? 'Show fewer notes' : `Show all ${notes.length} notes`}
    </button>
  {/if}
</section>

<style>
  textarea {
    width: 100%;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-2);
  }

  ul {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }

  .body {
    white-space: pre-wrap;
    max-width: 70ch;
  }

  .small {
    font-size: var(--step--1);
  }
</style>
