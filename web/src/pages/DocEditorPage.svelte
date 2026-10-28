<script lang="ts">
  // The resume and cover letter editor: Markdown on the left, the A4 page on
  // the right, and the fact-check above. Every save is a new version; a sent
  // version is read-only. Text you haven't saved is kept in this browser
  // until you save or discard it, so closing the tab never loses it.
  import { onMount, tick } from 'svelte';
  import type { Document, DocumentKind, DocumentSummary, ExporterInfo, Job } from '../../../shared/contracts/index.ts';
  import { formatDate } from '../../../shared/dates.ts';
  import { createFactChecker, type Flag } from '../../../shared/fact-check.ts';
  import CopyFromDialog from '../components/CopyFromDialog.svelte';
  import DocPreview from '../components/DocPreview.svelte';
  import FactCheckList from '../components/FactCheckList.svelte';
  import { api } from '../lib/api.ts';
  import { draftKey, KIND_LABEL, versionLabel } from '../lib/documents.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { displayCompany, displayTitle } from '../lib/format.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  let { jobId, docId, kind: kindFromUrl }: { jobId: number; docId: number | null; kind: DocumentKind | null } = $props();

  type Draft = { text: string; at: string };

  let job = $state<Job | null>(null);
  let doc = $state<Document | null>(null);
  let versions = $state<DocumentSummary[]>([]);
  let exporters = $state<ExporterInfo[]>([]);
  let profile = $state<string | null>(null);
  let templateCss = $state('');
  let text = $state('');
  let savedText = $state('');
  // Exactly what the AI last wrote, so an untouched draft saves as "written by the AI".
  let generatedText = $state<string | null>(null);
  let draft = $state<Draft | null>(null);
  // Set once everything has loaded and any draft has been read, so the draft
  // store never runs on a half-loaded page (and wipes the draft).
  let ready = $state(false);
  let flags = $state<Flag[]>([]);
  let generating = $state(false);
  let controller: AbortController | null = null;
  let busy = $state(false);
  let notice = $state<string | null>(null);
  let error = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let copyFrom = $state<CopyFromDialog>();
  let heading = $state<HTMLHeadingElement>();
  // The version chosen in the picker, opened with the Open button.
  let picked = $state('new');

  const kind = $derived<DocumentKind>(doc?.kind ?? kindFromUrl ?? 'resume');
  const sent = $derived(doc?.isSent === true);
  const dirty = $derived(!sent && text !== savedText);
  const css = $derived(sent ? (doc?.sentCss ?? '') : templateCss);
  const title = $derived(`${KIND_LABEL[kind]} – ${displayCompany(job?.company ?? null)}`);
  const checker = $derived(
    profile ? createFactChecker(profile, [job?.title, job?.company, job?.agency].filter((s): s is string => Boolean(s))) : null,
  );

  onMount(() => {
    void load();
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || generating) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      controller?.abort();
    };
  });

  async function load() {
    try {
      const [j, d, list, ex, master] = await Promise.all([
        api.getJob(jobId),
        docId === null ? Promise.resolve(null) : api.getDocument(docId),
        api.listDocuments(jobId),
        api.exporters(),
        api.getProfileFile('master-profile'),
      ]);
      job = j;
      doc = d;
      exporters = ex;
      profile = master.text.trim() ? master.text : null;
      const k = d?.kind ?? kindFromUrl ?? 'resume';
      versions = list.filter((v) => v.kind === k);
      templateCss = (await api.getProfileFile(k === 'resume' ? 'resume' : 'cover-letter')).text;
      text = d?.markdown ?? '';
      savedText = text;
      if (!d?.isSent) draft = readDraft(k, text);
      picked = d ? String(d.id) : 'new';
      ready = true;
      // The page's heading takes the focus, so a screen reader starts there.
      await tick();
      heading?.focus();
    } catch (err) {
      loadError = friendlyError(err);
    }
  }

  function readDraft(k: DocumentKind, current: string): Draft | null {
    try {
      const raw = localStorage.getItem(draftKey(jobId, k));
      const parsed = raw ? (JSON.parse(raw) as Draft) : null;
      return parsed && typeof parsed.text === 'string' && parsed.text !== current ? parsed : null;
    } catch {
      return null;
    }
  }

  // Keep unsaved text in this browser; forget it once it's saved.
  $effect(() => {
    if (!ready || sent || draft) return;
    const key = draftKey(jobId, kind);
    if (text !== savedText && text.trim()) localStorage.setItem(key, JSON.stringify({ text, at: new Date().toISOString() }));
    else localStorage.removeItem(key);
  });

  // The fact-check, 300 ms after you stop typing.
  $effect(() => {
    const check = checker;
    const draftText = text;
    if (!check) {
      flags = [];
      return;
    }
    const timer = setTimeout(() => (flags = check(draftText)), 300);
    return () => clearTimeout(timer);
  });

  function restoreDraft() {
    if (!draft) return;
    text = draft.text;
    draft = null;
  }

  function discardDraft() {
    localStorage.removeItem(draftKey(jobId, kind));
    draft = null;
  }

  // Text you'd lose: unsaved edits, or a draft waiting to be restored.
  const hasUnsaved = () => (dirty && text.trim() !== '') || draft !== null;

  async function generate() {
    if (hasUnsaved() && !confirm('Replace your unsaved text with a new draft? Your unsaved text will be lost.')) return;
    error = null;
    notice = null;
    generating = true;
    controller = new AbortController();
    const signal = controller.signal;
    // The old text stays until the first words of the new draft arrive, so a
    // draft that fails or is stopped straight away loses nothing.
    let started = false;
    try {
      for await (const chunk of api.generateDocument(jobId, kind, { signal })) {
        if (chunk.kind === 'text') {
          if (!started) {
            started = true;
            draft = null;
            text = '';
          }
          text += chunk.text;
        } else if (chunk.kind === 'error') error = chunk.message;
      }
      if (started && !error) generatedText = text;
    } catch (err) {
      if (!signal.aborted) error = friendlyError(err);
      else notice = started ? 'Stopped. The text so far is still here, not saved.' : 'Stopped before the AI wrote anything.';
    } finally {
      generating = false;
      controller = null;
    }
  }

  function stop() {
    controller?.abort();
  }

  async function saveVersion() {
    busy = true;
    error = null;
    try {
      const origin = text === generatedText ? 'generated' : 'edited';
      const saved = await api.saveDocument(jobId, { kind, markdown: text, origin });
      savedText = text;
      // The stored draft is this text, unless one is still waiting to be restored.
      if (!draft) localStorage.removeItem(draftKey(jobId, kind));
      showToast(`Saved as version ${saved.version}.`);
      navigate(`/jobs/${jobId}/documents/${saved.id}`);
    } catch (err) {
      error = friendlyError(err);
    } finally {
      busy = false;
    }
  }

  async function markSent() {
    if (!doc || !confirm(`Mark version ${doc.version} as sent? It can't be changed after this.`)) return;
    busy = true;
    error = null;
    try {
      doc = await api.markSent(doc.id);
      versions = (await api.listDocuments(jobId)).filter((v) => v.kind === kind);
      showToast(`Version ${doc.version} is marked as sent.`);
      await tick();
      heading?.focus();
    } catch (err) {
      error = friendlyError(err);
    } finally {
      busy = false;
    }
  }

  // "Start from another job's version" replaces what's in the editor, so it
  // asks first; "Save a copy" of a sent version leaves any stored draft alone.
  async function copy(fromDocumentId: number, o: { replacesEditor: boolean }) {
    if (o.replacesEditor && hasUnsaved() && !confirm('Start from that version instead? Your unsaved text will be lost.')) return;
    busy = true;
    error = null;
    try {
      const saved = await api.saveDocument(jobId, { fromDocumentId });
      if (o.replacesEditor) localStorage.removeItem(draftKey(jobId, kind));
      showToast(`Saved as version ${saved.version}.`);
      navigate(`/jobs/${jobId}/documents/${saved.id}`);
    } catch (err) {
      error = friendlyError(err);
    } finally {
      busy = false;
    }
  }

  // The picker moves only when you press Open, so arrow keys can browse it.
  function openPicked() {
    navigate(picked === 'new' ? `/jobs/${jobId}/documents/new?kind=${kind}` : `/jobs/${jobId}/documents/${picked}`);
  }
</script>

<main class="page editor">
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
    <p><a href="/jobs/{jobId}">Back to the job</a></p>
  {:else if job && ready}
    <header class="top">
      <div>
        <p class="muted"><a href="/jobs/{jobId}">← {displayTitle(job.title)} · {displayCompany(job.company)}</a></p>
        <h1 bind:this={heading} tabindex="-1">{KIND_LABEL[kind]}</h1>
      </div>
      <div class="version">
      <label class="field">
        <span>Version</span>
        <select aria-label="Version" bind:value={picked}>
          {#if !doc}<option value="new">New, not saved yet</option>{/if}
          {#each versions as v (v.id)}
            <option value={String(v.id)}>{versionLabel(v)}</option>
          {/each}
        </select>
      </label>
      <button type="button" class="button" disabled={picked === (doc ? String(doc.id) : 'new')} onclick={openPicked}>Open</button>
      </div>
    </header>

    {#if draft && !sent}
      <div class="draft" role="status">
        <span>You have unsaved text from {new Date(draft.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}.</span>
        <button type="button" class="button" onclick={restoreDraft}>Restore</button>
        <button type="button" class="button quiet" onclick={discardDraft}>Discard</button>
      </div>
    {/if}

    <div class="toolbar">
      {#if sent}
        <p class="sent-note">Sent on {formatDate(doc?.sentAt ?? null)}. Save a copy to change it.</p>
        <button type="button" class="button primary" disabled={busy} onclick={() => doc && copy(doc.id, { replacesEditor: false })}>Save a copy</button>
      {:else}
        {#if generating}
          <button type="button" class="button" onclick={stop}>Stop</button>
          <span class="muted" aria-live="polite">Writing…</span>
        {:else}
          <button type="button" class="button" disabled={busy} onclick={generate}>Generate {KIND_LABEL[kind].toLowerCase()}</button>
        {/if}
        <button type="button" class="button primary" disabled={busy || generating || !dirty || !text.trim()} onclick={saveVersion}>Save version</button>
        {#if doc}
          <button type="button" class="button" disabled={busy || generating || dirty} onclick={markSent}>Mark as sent</button>
        {/if}
        <button type="button" class="button quiet" disabled={busy || generating} onclick={() => copyFrom?.open()}>Start from another job's version</button>
      {/if}
    </div>

    {#if doc}
      <div class="toolbar exports">
        {#if dirty}
          <span class="muted">Save the version to print or export it.</span>
        {:else}
          <a class="button" href="/api/v1/documents/{doc.id}/render" target="_blank" rel="noopener">Print / PDF</a>
          {#each exporters as e (e.id)}
            <a class="button quiet" href="/api/v1/documents/{doc.id}/export?format={e.id}" download>{e.label}</a>
          {/each}
          <span class="muted hint">Print / PDF opens the page in a new tab. Press Ctrl+P there, choose Save to PDF and A4, and untick Headers and footers.</span>
        {/if}
      </div>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if notice}<p class="muted" role="status">{notice}</p>{/if}

    <FactCheckList {flags} hasProfile={profile !== null} />

    <div class="panes">
      <label class="visually-hidden" for="doc-text">Document text</label>
      <textarea id="doc-text" class="mono" bind:value={text} readonly={sent || generating} spellcheck="true"></textarea>
      <DocPreview {title} markdown={text} {css} highlight={flags.map((f) => f.text)} />
    </div>

    <CopyFromDialog bind:this={copyFrom} {jobId} {kind} onPick={(id) => copy(id, { replacesEditor: true })} />
  {/if}
</main>

<style>
  .editor {
    display: grid;
    gap: var(--space-4);
    max-width: none;
  }

  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  h1 {
    font-size: var(--step-3);
  }

  .version {
    display: flex;
    align-items: end;
    gap: var(--space-2);
  }

  .version select {
    min-width: 18rem;
  }

  h1:focus {
    outline: none;
  }

  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .hint {
    font-size: var(--step--1);
  }

  .sent-note {
    margin: 0;
    font-weight: 600;
  }

  .draft {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--sheet);
  }

  .panes {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
    gap: var(--space-4);
    align-items: stretch;
  }

  .panes textarea {
    min-height: 70vh;
    width: 100%;
    box-sizing: border-box;
  }

  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: var(--step--1);
  }

  @media (max-width: 60rem) {
    .panes {
      grid-template-columns: 1fr;
    }
  }
</style>
