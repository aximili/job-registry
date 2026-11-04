<script lang="ts">
  // The resume and cover letter editor: Markdown on the left, the A4 page on
  // the right, and the fact-check above. Every save is a new version; a sent
  // version is read-only. Text you haven't saved is kept in this browser
  // until you save or discard it, so closing the tab never loses it.
  // "Before I write" is the brief you check before the AI writes: the main
  // button makes one when the job has none, and otherwise writes with it.
  import { onMount, tick } from 'svelte';
  import { ApiError } from '../../../shared/api-client.ts';
  import { writingAi, type Brief, type Document, type DocumentKind, type DocumentSummary, type ExporterInfo, type Job, type Note } from '../../../shared/contracts/index.ts';
  import { formatDate } from '../../../shared/dates.ts';
  import { createFactChecker, type Flag } from '../../../shared/fact-check.ts';
  import BriefPanel from '../components/BriefPanel.svelte';
  import CopyFromDialog from '../components/CopyFromDialog.svelte';
  import DocPreview from '../components/DocPreview.svelte';
  import FactCheckList from '../components/FactCheckList.svelte';
  import { api } from '../lib/api.ts';
  import { app } from '../lib/app-state.svelte.ts';
  import { answersAdded, applyChange, editsOf, mergeSaved, type BriefChange, type Progress } from '../lib/brief.ts';
  import { debounceLatest } from '../lib/debounce.ts';
  import { draftKey, KIND_LABEL, versionLabel } from '../lib/documents.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { displayCompany, displayTitle } from '../lib/format.ts';
  import { BRIEF_EVENTS, onLive, onReconnect } from '../lib/live.svelte.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  let { jobId, docId, kind: kindFromUrl }: { jobId: number; docId: number | null; kind: DocumentKind | null } = $props();

  type Draft = { text: string; at: string };
  type Running = Progress & { since: number };

  const NEWER_SHOWN = "There's a newer brief for this job, so it's shown here now. Check it again.";

  let job = $state<Job | null>(null);
  let doc = $state<Document | null>(null);
  let versions = $state<DocumentSummary[]>([]);
  let exporters = $state<ExporterInfo[]>([]);
  let profile = $state<string | null>(null);
  let notes = $state<Note[]>([]);
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
  let controller: AbortController | null = null;
  let busy = $state(false);
  let error = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let copyFrom = $state<CopyFromDialog>();
  let heading = $state<HTMLHeadingElement>();
  let panel = $state<BriefPanel>();
  let textBox = $state<HTMLTextAreaElement>();
  // The version chosen in the picker, opened with the Open button.
  let picked = $state('new');

  // The job's brief, and what's going on with it.
  let brief = $state<Brief | null>(null);
  let making = $state<Running | null>(null);
  let writing = $state<Running | null>(null);
  let briefController: AbortController | null = null;
  // Skip, just write while a brief is being made: its Cancel says nothing.
  let skipping = false;
  let briefError = $state<string | null>(null);
  let briefNotice = $state<string | null>(null);
  let now = $state(Date.now());
  // The times of this page's own saves, so their echoes are skipped.
  const ownSaves = new Set<string>();
  // The brief folds to one line when the page opens with text, and when a
  // draft's first words arrive; never as you type. It comes back when you
  // show it or make a new one.
  let folded = $state(false);

  const kind = $derived<DocumentKind>(doc?.kind ?? kindFromUrl ?? 'resume');
  const sent = $derived(doc?.isSent === true);
  const dirty = $derived(!sent && text !== savedText);
  const generating = $derived(writing !== null);
  const css = $derived(sent ? (doc?.sentCss ?? '') : templateCss);
  const title = $derived(`${KIND_LABEL[kind]} – ${displayCompany(job?.company ?? null)}`);
  const hasText = $derived(text.trim() !== '');
  // Facts from you: your master profile, your notes on this job, and your
  // answers in its brief.
  const answersText = $derived(
    brief ? brief.questions.filter((q) => !q.skipped && q.answer?.trim()).map((q) => `${q.question} ${q.answer}`).join('\n') : '',
  );
  const facts = $derived(profile ? [profile, ...notes.map((n) => n.body), answersText].filter(Boolean).join('\n\n') : null);
  const allowed = $derived(
    [job?.title, job?.company, job?.agency, brief?.contact.name, brief?.contact.organisation].filter((s): s is string => Boolean(s)),
  );
  const checker = $derived(facts ? createFactChecker(facts, allowed) : null);

  const writerName = () => writingAi(app.settings.ai).ai.name;

  onMount(() => {
    void load();
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || generating || making) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    const offBrief = onLive(BRIEF_EVENTS, (_name, payload) => {
      const p = payload as { jobId: number; briefId: number; updatedAt: string };
      if (p.jobId === jobId) void briefSaved(p);
    });
    // Back after a gap: a change may have been missed.
    const offReconnect = onReconnect(() => void briefSaved(null));
    return () => {
      window.removeEventListener('beforeunload', warn);
      offBrief();
      offReconnect();
      saveBrief.flush();
      controller?.abort();
      briefController?.abort();
    };
  });

  // The clock for "… is making the brief… 0:42".
  $effect(() => {
    if (!making && !writing) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  async function load() {
    try {
      const [j, d, list, ex, master, b, n] = await Promise.all([
        api.getJob(jobId),
        docId === null ? Promise.resolve(null) : api.getDocument(docId),
        api.listDocuments(jobId),
        api.exporters(),
        api.getProfileFile('master-profile'),
        api.getBrief(jobId),
        api.listNotes(jobId),
      ]);
      job = j;
      doc = d;
      exporters = ex;
      profile = master.text.trim() ? master.text : null;
      brief = b.brief;
      notes = n;
      const k = d?.kind ?? kindFromUrl ?? 'resume';
      versions = list.filter((v) => v.kind === k);
      templateCss = (await api.getProfileFile(k === 'resume' ? 'resume' : 'cover-letter')).text;
      text = d?.markdown ?? '';
      savedText = text;
      folded = text.trim() !== '';
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
  const mayReplace = () => !hasUnsaved() || confirm('Replace your unsaved text with a new draft? Your unsaved text will be lost.');

  // The brief -----------------------------------------------------------

  // Each change saves on its own: what you type 500 ms after you stop, a
  // click at once. The last change always wins.
  const saveBrief = debounceLatest(async (b: Brief) => {
    try {
      const saved = await api.editBrief(b.id, editsOf(b));
      ownSaves.add(saved.updatedAt);
      if (brief?.id === saved.id) brief = mergeSaved(brief, saved);
    } catch (err) {
      await briefFailed(err);
    }
  }, 500);

  function change(c: BriefChange) {
    if (!brief) return;
    brief = applyChange(brief, c);
    saveBrief(brief);
    if (c.kind !== 'name' && c.kind !== 'answer') saveBrief.flush();
  }

  // A newer brief (made in another tab) is shown; anything else says why.
  async function briefFailed(err: unknown) {
    if (err instanceof ApiError && err.status === 409) {
      brief = (await api.getBrief(jobId).catch(() => ({ brief }))).brief;
      briefError = NEWER_SHOWN;
    } else briefError = friendlyError(err);
  }

  // Another tab changed the brief, or made a new one (null: it may have).
  // This page's own saves come back too: those are skipped.
  async function briefSaved(p: { briefId: number; updatedAt: string } | null) {
    await saveBrief.settled();
    if (p && ownSaves.has(p.updatedAt)) return;
    if (p && brief?.id === p.briefId && brief.updatedAt === p.updatedAt) return;
    try {
      brief = (await api.getBrief(jobId)).brief;
    } catch {
      // The next change or reload shows it.
    }
  }

  async function makeBrief() {
    if (making || writing) return;
    // Running at once, before anything is awaited, so a second click finds
    // Cancel, not this button.
    const run = new AbortController();
    briefController = run;
    const signal = run.signal;
    skipping = false;
    making = { task: 'brief', phase: 'waiting', by: writerName(), since: Date.now() };
    briefError = null;
    briefNotice = null;
    let made = false;
    try {
      // Your changes to the old brief first, so the new one carries your answers.
      await saveBrief.settled();
      for await (const line of api.makeBrief(jobId, { signal })) {
        if (line.kind === 'waiting') making = { task: 'brief', phase: 'waiting', by: line.by, since: Date.now() };
        else if (line.kind === 'working') making = { task: 'brief', phase: 'working', by: line.by, since: Date.now() };
        else if (line.kind === 'done') {
          ownSaves.add(line.brief.updatedAt);
          brief = line.brief;
          made = true;
        } else if (line.kind === 'error') briefError = line.message;
      }
    } catch (err) {
      if (!signal.aborted) briefError = friendlyError(err);
      else if (!skipping) briefNotice = 'Stopped. No new brief was made.';
    } finally {
      // Skip, just write may have started a draft by now: that one is left alone.
      if (briefController === run) {
        making = null;
        briefController = null;
      }
    }
    if (made) {
      folded = false;
      await tick();
      panel?.focusHeading();
    }
  }

  function cancelBrief() {
    briefController?.abort();
  }

  // The main button: a brief first when the job has none; else your ticked
  // answers go in your master profile, and the AI writes with the brief.
  async function write() {
    if (making || writing) return;
    if (!brief) return makeBrief();
    if (!mayReplace()) return;
    // Waiting and Stop show at once, so a second click can't start another
    // draft, and Stop works while your answers are saved.
    const run = startWriting();
    try {
      await saveBrief.settled();
      if (briefError || !brief) return;
      const id = brief.id;
      if (!run.signal.aborted) {
        try {
          const message = answersAdded((await api.addAnswersToProfile(id)).added);
          if (message) showToast(message);
        } catch (err) {
          return await briefFailed(err);
        }
      }
      await runDraft(run, 'use', id);
    } finally {
      endWriting(run);
    }
  }

  async function skipAndWrite() {
    if (writing) return;
    if (!mayReplace()) return;
    if (making) {
      skipping = true;
      briefController?.abort();
    }
    await runDraft(startWriting(), 'skip');
  }

  // The draft ------------------------------------------------------------

  // Each run has its own controller, so a run that ends late never clears
  // the state of a newer one.
  function startWriting(): AbortController {
    error = null;
    briefError = null;
    briefNotice = null;
    const run = new AbortController();
    controller = run;
    writing = { task: 'draft', phase: 'waiting', by: writerName(), since: Date.now() };
    return run;
  }

  function endWriting(run: AbortController) {
    if (controller !== run) return;
    writing = null;
    controller = null;
  }

  async function runDraft(run: AbortController, mode: 'use' | 'skip', briefId?: number) {
    const signal = run.signal;
    // The old text stays until the first words of the new draft arrive, so a
    // draft that fails or is stopped straight away loses nothing.
    let started = false;
    let failed: string | null = null;
    try {
      for await (const chunk of api.generateDocument(jobId, kind, { signal, brief: mode, briefId })) {
        if (chunk.kind === 'waiting') writing = { task: 'draft', phase: 'waiting', by: chunk.by, since: Date.now() };
        else if (chunk.kind === 'working') writing = { task: 'draft', phase: 'working', by: chunk.by, since: Date.now() };
        else if (chunk.kind === 'text') {
          if (!started) {
            started = true;
            draft = null;
            text = '';
            // Once written, the brief folds to one line.
            folded = true;
          }
          text += chunk.text;
        } else if (chunk.kind === 'error') failed = chunk.message;
      }
      if (started && !failed) generatedText = text;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) await briefFailed(err);
      else if (!signal.aborted) failed = friendlyError(err);
      else briefNotice = started ? 'Stopped. The text so far is still here, not saved.' : 'Stopped before the AI wrote anything.';
    } finally {
      endWriting(run);
    }
    if (failed) briefError = failed;
    // The cursor was on Stop, which has gone with the brief folded: the text is next.
    await tick();
    if (started && (document.activeElement === document.body || !document.activeElement)) textBox?.focus();
  }

  function stop() {
    controller?.abort();
  }

  // Versions -------------------------------------------------------------

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

    {#if !sent}
      <BriefPanel
        bind:this={panel}
        {brief}
        {kind}
        {folded}
        canFold={hasText}
        {making}
        {writing}
        {now}
        error={briefError}
        notice={briefNotice}
        onchange={change}
        onwrite={write}
        onskip={skipAndWrite}
        onnew={makeBrief}
        oncancel={cancelBrief}
        onstop={stop}
        onfold={(next) => (folded = next)}
      />
    {/if}

    <div class="toolbar">
      {#if sent}
        <p class="sent-note">Sent on {formatDate(doc?.sentAt ?? null)}. Save a copy to change it.</p>
        <button type="button" class="button primary" disabled={busy} onclick={() => doc && copy(doc.id, { replacesEditor: false })}>Save a copy</button>
      {:else}
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

    <FactCheckList {flags} hasProfile={profile !== null} />

    <div class="panes">
      <label class="visually-hidden" for="doc-text">Document text</label>
      <textarea id="doc-text" class="mono" bind:this={textBox} bind:value={text} readonly={sent || generating} spellcheck="true"></textarea>
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
