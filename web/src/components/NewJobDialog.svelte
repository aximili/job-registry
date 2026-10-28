<script lang="ts">
  // Add a job from a pasted link or pasted ad text. The ad is read first, then
  // you check the details. If it looks like a job you've already saved, you choose.
  import { tick } from 'svelte';
  import type { Candidate, Capture, EditableJobFields, SaveDecision } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { statuses } from '../lib/app-state.svelte.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import SamePrompt from './SamePrompt.svelte';

  type Step = 'paste' | 'details' | 'same';
  type Details = { title: string; company: string; agency: string; location: string };

  let dialog: HTMLDialogElement;
  let pasteBox = $state<HTMLTextAreaElement>();
  let body = $state<HTMLDivElement>();
  let roleInput = $state<HTMLInputElement>();
  let step = $state<Step>('paste');
  let pasted = $state('');
  let capture = $state<Capture | null>(null);
  let warning = $state<string | null>(null);
  let adText = $state('');
  let details = $state<Details>({ title: '', company: '', agency: '', location: '' });
  let prefill: Details = { title: '', company: '', agency: '', location: '' };
  let status = $state('saved');
  let note = $state('');
  let candidates = $state<Candidate[]>([]);
  let busy = $state(false);
  let error = $state<string | null>(null);

  export async function open(text = '') {
    step = 'paste';
    pasted = text;
    capture = null;
    warning = null;
    adText = '';
    details = { title: '', company: '', agency: '', location: '' };
    status = 'saved';
    note = '';
    candidates = [];
    error = null;
    busy = false;
    if (!dialog.open) dialog.showModal();
    await tick();
    pasteBox?.focus();
  }

  const isLink = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

  async function readAd() {
    if (!pasted.trim() || busy) return;
    busy = true;
    error = null;
    try {
      const res = await api.previewCapture(isLink(pasted) ? { url: pasted.trim() } : { text: pasted });
      capture = res.capture;
      warning = res.warning;
      adText = res.capture.jdText;
      const s = res.capture.structured ?? {};
      prefill = {
        title: s.title ?? res.capture.title ?? '',
        company: s.company ?? res.capture.company ?? '',
        agency: s.agency ?? '',
        location: s.location ?? res.capture.location ?? '',
      };
      details = { ...prefill };
      step = 'details';
      await tick();
      roleInput?.focus();
    } catch (err) {
      error = friendlyError(err);
    } finally {
      busy = false;
    }
  }

  async function save(decision?: SaveDecision) {
    if (!capture || busy) return;
    busy = true;
    error = null;
    // Only what you typed or changed counts as yours. The rest stays "from the ad".
    const fields: Partial<EditableJobFields> = {};
    for (const key of ['title', 'company', 'agency', 'location'] as const) {
      if (details[key] !== prefill[key]) fields[key] = details[key];
    }
    try {
      const res = await api.saveJob({
        capture: { ...capture, jdText: adText },
        fields,
        status,
        ...(decision ? { decision } : {}),
      });
      if (res.result === 'needs_decision') {
        candidates = res.candidates;
        step = 'same';
        return;
      }
      // Even for a job you'd already saved, the note you typed is kept.
      if (note.trim()) await api.addNote(res.job.id, note);
      if (res.result === 'linked') showToast('Added this ad to the existing job.');
      if (res.result === 'exists') showToast("You've already saved this job.");
      dialog.close();
      navigate(`/jobs/${res.job.id}`);
    } catch (err) {
      error = friendlyError(err);
    } finally {
      busy = false;
      // The "Same job" buttons are disabled while saving, so they can take focus only now.
      if (step === 'same' && dialog.open) {
        await tick();
        body?.querySelector<HTMLButtonElement>('.candidate button')?.focus();
      }
    }
  }
</script>

<dialog bind:this={dialog} aria-labelledby="new-job-title">
  <div class="dialog-body" bind:this={body}>
    <h2 id="new-job-title">New job</h2>

    {#if step === 'paste'}
      <form
        class="stack"
        onsubmit={(e) => {
          e.preventDefault();
          void readAd();
        }}
      >
        <label class="field">
          <span>Paste a job link or the ad text</span>
          <textarea bind:this={pasteBox} bind:value={pasted} rows="8"></textarea>
        </label>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="dialog-actions">
          <button type="button" class="button" onclick={() => dialog.close()}>Cancel</button>
          <button type="submit" class="button primary" disabled={busy || !pasted.trim()}>
            {busy ? 'Reading the ad…' : 'Continue'}
          </button>
        </div>
      </form>
    {:else if step === 'details'}
      <form
        class="stack"
        onsubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {#if warning}<p class="warning" role="alert">{warning}</p>{/if}
        <div class="grid">
          <label class="field wide"><span>Role</span><input bind:this={roleInput} bind:value={details.title} /></label>
          <label class="field"><span>Company</span><input bind:value={details.company} /></label>
          <label class="field"><span>Agency</span><input bind:value={details.agency} placeholder="If a recruiter posted it" /></label>
          <label class="field"><span>Location</span><input bind:value={details.location} /></label>
          <label class="field">
            <span>Status</span>
            <select bind:value={status}>
              {#each statuses() as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
            </select>
          </label>
          <label class="field wide"><span>Note</span><textarea bind:value={note} rows="2" placeholder="Optional"></textarea></label>
          <label class="field wide">
            <span>Ad text</span>
            <textarea bind:value={adText} rows="5" placeholder="Paste the ad text here to keep a copy"></textarea>
          </label>
        </div>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="dialog-actions">
          <button type="button" class="button" onclick={() => (step = 'paste')}>Back</button>
          <button type="submit" class="button primary" disabled={busy}>Save job</button>
        </div>
      </form>
    {:else}
      <SamePrompt
        {candidates}
        {busy}
        onSame={(jobId) => void save({ linkTo: jobId })}
        onDifferent={() => void save('new')}
      />
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    {/if}
  </div>
</dialog>

<style>
  .stack {
    display: grid;
    gap: var(--space-4);
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .wide {
    grid-column: 1 / -1;
  }

  textarea {
    width: 100%;
  }

  .warning {
    padding: var(--space-3) var(--space-4);
    border-left: 3px solid var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, transparent);
    border-radius: 0 var(--radius) var(--radius) 0;
  }
</style>
