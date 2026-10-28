<script lang="ts">
  // A job's resumes and cover letters (every version, newest first) and the
  // files you attached, with links to the editor and to download each file.
  import type { Attachment, AttachmentKind, DocumentKind, DocumentSummary } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { KIND_LABEL, versionLabel } from '../lib/documents.ts';
  import { friendlyError } from '../lib/errors.ts';

  let {
    jobId,
    documents,
    attachments,
    onChanged,
  }: { jobId: number; documents: DocumentSummary[]; attachments: Attachment[]; onChanged: () => void } = $props();

  const KINDS: DocumentKind[] = ['resume', 'cover_letter'];
  const FILE_KINDS: { id: AttachmentKind; label: string }[] = [
    { id: 'resume', label: 'Resume' },
    { id: 'cover_letter', label: 'Cover letter' },
    { id: 'other', label: 'Other' },
  ];

  let fileInput = $state<HTMLInputElement>();
  let fileKind = $state<AttachmentKind>('resume');
  let uploading = $state(false);
  let error = $state<string | null>(null);

  const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

  async function attach() {
    const file = fileInput?.files?.[0];
    if (!file) {
      error = 'Choose a file to attach.';
      return;
    }
    uploading = true;
    error = null;
    try {
      await api.attachFile(jobId, fileKind, file, file.name);
      if (fileInput) fileInput.value = '';
      onChanged();
    } catch (err) {
      error = friendlyError(err);
    } finally {
      uploading = false;
    }
  }
</script>

<section aria-labelledby="documents-heading" class="documents">
  <h2 id="documents-heading">Documents</h2>

  <div class="kinds">
    {#each KINDS as kind (kind)}
      {@const versions = documents.filter((d) => d.kind === kind)}
      <div class="kind">
        <h3>{KIND_LABEL[kind]}</h3>
        {#if versions.length === 0}
          <p class="muted">None yet.</p>
        {:else}
          <ul>
            {#each versions as v (v.id)}
              <li><a href="/jobs/{jobId}/documents/{v.id}" class:sent={v.isSent}>{versionLabel(v)}</a></li>
            {/each}
          </ul>
        {/if}
        <a class="button" href="/jobs/{jobId}/documents/new?kind={kind}">New {KIND_LABEL[kind].toLowerCase()}</a>
      </div>
    {/each}
  </div>

  <div class="files">
    <h3>Attached files</h3>
    {#if attachments.length === 0}
      <p class="muted">Keep a PDF or Word file you made elsewhere with this job.</p>
    {:else}
      <ul>
        {#each attachments as a (a.id)}
          <li>
            <a href="/api/v1/attachments/{a.id}" download>{a.fileName}</a>
            <span class="muted">{FILE_KINDS.find((k) => k.id === a.kind)?.label} · {size(a.sizeBytes)}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="attach">
      <select aria-label="Kind of file" bind:value={fileKind}>
        {#each FILE_KINDS as k (k.id)}<option value={k.id}>{k.label}</option>{/each}
      </select>
      <input bind:this={fileInput} type="file" aria-label="File to attach" accept=".pdf,.docx,.doc,.rtf,.txt,.odt" />
      <button type="button" class="button" disabled={uploading} onclick={attach}>Attach file</button>
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
</section>

<style>
  .documents {
    display: grid;
    gap: var(--space-4);
    margin-top: var(--space-6);
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: var(--space-5);
  }

  h2 {
    font-size: var(--step-1);
  }

  h3 {
    font-size: var(--step-0);
    margin-bottom: var(--space-2);
  }

  .kinds {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: var(--space-5);
  }

  ul {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-4);
  }

  .sent {
    font-weight: 600;
  }

  .attach {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
