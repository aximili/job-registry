<script lang="ts">
  import { onMount } from 'svelte';
  import type { CallSheet as Sheet } from '../../../shared/contracts/index.ts';
  import { ApiError } from '../../../shared/api-client.ts';
  import AdText from '../components/AdText.svelte';
  import CallSheet from '../components/CallSheet.svelte';
  import DocumentsPanel from '../components/DocumentsPanel.svelte';
  import EditJobDialog from '../components/EditJobDialog.svelte';
  import LogCallDialog from '../components/LogCallDialog.svelte';
  import Timeline from '../components/Timeline.svelte';
  import { api } from '../lib/api.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { statusLabel } from '../lib/app-state.svelte.ts';
  import { isShortcut, isTypingTarget } from '../lib/keys.ts';
  import { JOB_EVENTS, onLive, onReconnect } from '../lib/live.svelte.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { buildTimeline } from '../lib/timeline.ts';

  let { id }: { id: number } = $props();

  let sheet = $state<Sheet | null>(null);
  let missing = $state(false);
  let error = $state<string | null>(null);
  let logCall = $state<LogCallDialog>();
  let editJob = $state<EditJobDialog>();

  async function load() {
    try {
      sheet = await api.getCallSheet(id);
      error = null;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'not_found') missing = true;
      else error = friendlyError(err);
    }
  }

  onMount(() => {
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onLive(JOB_EVENTS, (_name, payload) => {
      const p = payload as { jobId?: number | null; jobIds?: number[] };
      if (p.jobId !== id && !p.jobIds?.includes(id)) return;
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 150);
    });
    const offReconnect = onReconnect(() => void load());
    return () => {
      off();
      offReconnect();
      clearTimeout(timer);
    };
  });

  async function changeStatus(status: string) {
    try {
      await api.changeStatus(id, status);
      await load();
    } catch (err) {
      error = friendlyError(err);
    }
  }

  async function archive() {
    if (!confirm('Archive this job? It will be hidden from your lists and from search.')) return;
    try {
      await api.updateJob(id, { archived: true });
      navigate('/');
    } catch (err) {
      error = friendlyError(err);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (!sheet || document.querySelector('dialog[open]')) return;
    if (isShortcut(event, 's')) {
      event.preventDefault();
      document.getElementById('status-picker')?.focus();
    } else if (isShortcut(event, 'l')) {
      event.preventDefault();
      logCall?.open();
    } else if (isShortcut(event, 'e')) {
      event.preventDefault();
      editJob?.open();
    } else if (event.key === 'Escape' && !isTypingTarget(document.activeElement)) {
      navigate('/');
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<main class="page job">
  {#if missing}
    <h1>This job isn't here.</h1>
    <p class="muted">It may have been archived. <a href="/">Go to your jobs</a></p>
  {:else if sheet}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <CallSheet
      {sheet}
      onStatusChange={changeStatus}
      onLogCall={() => logCall?.open()}
      onEdit={() => editJob?.open()}
      onArchive={archive}
      onChanged={load}
    />
    <DocumentsPanel jobId={id} documents={sheet.documents} attachments={sheet.attachments} onChanged={load} />
    <div class="below">
      <Timeline items={buildTimeline(sheet, statusLabel)} />
      <AdText postings={sheet.postings} />
    </div>
    <LogCallDialog bind:this={logCall} jobId={id} people={sheet.people} onSaved={load} />
    <EditJobDialog bind:this={editJob} job={sheet.job} onSaved={load} />
  {:else if error}
    <p class="error" role="alert">{error}</p>
  {/if}
</main>

<style>
  .below {
    display: grid;
    grid-template-columns: 1fr 1.3fr;
    gap: var(--space-6);
    margin-top: var(--space-6);
  }

  @media (max-width: 48rem) {
    .below {
      grid-template-columns: 1fr;
    }
  }
</style>
