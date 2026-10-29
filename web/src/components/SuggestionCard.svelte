<script lang="ts">
  // One email on the Inbox: what it is, who sent it, the job it's about and
  // the status it points to. Nothing changes until you press Confirm.
  import { tick } from 'svelte';
  import type { EmailSuggestion, JobHit } from '../../../shared/contracts/index.ts';
  import { suggestStatus } from '../../../shared/email-status.ts';
  import { api } from '../lib/api.ts';
  import { statusLabel, statuses } from '../lib/app-state.svelte.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { displayCompany, displayTitle, formatDate } from '../lib/format.ts';
  import { doneMessage, eventLabel, questionFor } from '../lib/inbox.ts';
  import JobPicker from './JobPicker.svelte';

  type CardJob = { id: number; title: string | null; company: string | null; status: string };

  let { suggestion, onDone }: { suggestion: EmailSuggestion; onDone: (id: number, message: string) => void } = $props();

  // The job you picked instead, if any.
  let picked = $state<CardJob | null>(null);
  let choice = $state<string | null>(null);
  let picking = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let statusSelect = $state<HTMLSelectElement>();
  let pickButton = $state<HTMLButtonElement>();

  const job = $derived<CardJob | null>(picked ?? (suggestion.job ? { ...suggestion.job } : null));
  // The status the card will set: your choice, or the suggestion ("" = don't change).
  const status = $derived(choice ?? suggestion.suggestedStatus ?? '');
  const headingId = $derived(`suggestion-${suggestion.id}`);

  // After a pick the focus goes to the status, the next thing to decide.
  async function pick(hit: JobHit) {
    picked = { id: hit.jobId, title: hit.title, company: hit.company, status: hit.status };
    choice = suggestStatus(suggestion.event, hit.status, statuses()) ?? '';
    picking = false;
    await tick();
    statusSelect?.focus();
  }

  async function closePicker() {
    picking = false;
    await tick();
    pickButton?.focus();
  }

  async function confirm() {
    busy = true;
    error = null;
    try {
      const done = await api.confirmSuggestion(suggestion.id, {
        ...(picked ? { jobId: picked.id } : {}),
        status: status || null,
      });
      onDone(suggestion.id, doneMessage(done, statuses()));
    } catch (err) {
      error = friendlyError(err);
      busy = false;
    }
  }

  async function dismiss() {
    busy = true;
    error = null;
    try {
      await api.dismissSuggestion(suggestion.id);
      onDone(suggestion.id, 'Dismissed.');
    } catch (err) {
      error = friendlyError(err);
      busy = false;
    }
  }
</script>

<article class="card" aria-labelledby={headingId}>
  <header>
    <h3 id={headingId} tabindex="-1">{eventLabel(suggestion.event)}</h3>
    {#if suggestion.confidence < 0.6}<span class="unsure">Not sure</span>{/if}
  </header>
  <p class="muted from">{suggestion.fromAddr} · {formatDate(suggestion.receivedAt)}</p>
  <p class="subject">{suggestion.subject}</p>
  <p>{suggestion.summary}</p>
  <p class="job">
    {#if job}
      <a href="/jobs/{job.id}">{displayTitle(job.title)} at {displayCompany(job.company)}</a>
      <span class="muted"> · now {statusLabel(job.status)}</span>
    {:else}
      No job matched{suggestion.company ? ` (the email names ${suggestion.company})` : ''}. Pick the job it's about.
    {/if}
  </p>

  {#if picking}
    <JobPicker onPick={pick} onCancel={closePicker} />
  {/if}

  <p class="question">{questionFor({ suggestedStatus: status || null }, statuses())}</p>
  <div class="actions">
    <label class="field">
      <span>New status</span>
      <select value={status} onchange={(e) => (choice = e.currentTarget.value)} disabled={!job} bind:this={statusSelect}>
        <option value="">Don't change the status</option>
        {#each statuses() as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
      </select>
    </label>
    <button type="button" class="button primary" disabled={busy || !job} onclick={confirm}>{status ? 'Confirm' : 'Add note'}</button>
    <button
      type="button"
      class="button"
      disabled={busy}
      aria-expanded={picking}
      bind:this={pickButton}
      onclick={() => (picking ? void closePicker() : (picking = true))}>{job ? 'Pick another job' : 'Pick a job'}</button
    >
    <button type="button" class="button quiet" disabled={busy} onclick={dismiss}>Dismiss</button>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</article>

<style>
  .card {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--sheet);
  }

  header {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
  }

  h3 {
    margin: 0;
  }

  h3:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  p {
    margin: 0;
  }

  .subject {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .unsure {
    font-size: var(--step--1);
    color: var(--ink-2);
    border: 1px solid var(--rule);
    border-radius: 999px;
    padding: 0 var(--space-2);
  }

  .question {
    font-weight: 600;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: end;
  }
</style>
