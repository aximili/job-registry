<script lang="ts">
  // "Start from another job's version": pick a resume or cover letter you
  // made for another job, and it's copied here as a new version.
  import type { DocumentKind, DocumentListItem } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { KIND_LABEL, versionLabel } from '../lib/documents.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { displayCompany, displayTitle } from '../lib/format.ts';

  let { jobId, kind, onPick }: { jobId: number; kind: DocumentKind; onPick: (documentId: number) => void } = $props();

  let dialog: HTMLDialogElement;
  let items = $state<DocumentListItem[] | null>(null);
  let error = $state<string | null>(null);

  export async function open() {
    items = null;
    error = null;
    dialog.showModal();
    try {
      items = (await api.listAllDocuments(kind)).filter((d) => d.jobId !== jobId);
    } catch (err) {
      error = friendlyError(err);
    }
  }

  function pick(id: number) {
    dialog.close();
    onPick(id);
  }
</script>

<dialog bind:this={dialog} aria-labelledby="copy-from-title">
  <div class="dialog-body">
    <h2 id="copy-from-title">Start from another job's {KIND_LABEL[kind].toLowerCase()}</h2>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {:else if items === null}
      <p class="muted">Loading…</p>
    {:else if items.length === 0}
      <p class="muted">You haven't saved a {KIND_LABEL[kind].toLowerCase()} for another job yet.</p>
    {:else}
      <ul class="list">
        {#each items as item (item.id)}
          <li>
            <button type="button" class="button quiet pick" onclick={() => pick(item.id)}>
              <span>{displayTitle(item.jobTitle)} · {displayCompany(item.company)}</span>
              <span class="muted">{versionLabel(item)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="actions">
      <button type="button" class="button" onclick={() => dialog.close()}>Cancel</button>
    </div>
  </div>
</dialog>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
    max-height: 60vh;
    overflow: auto;
  }

  .pick {
    width: 100%;
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    text-align: left;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-4);
  }
</style>
