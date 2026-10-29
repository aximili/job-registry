<script lang="ts">
  // Set, change or clear a job's follow-up: the day to chase it, and why.
  import type { Job } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { addDays, QUICK_PICKS, today } from '../lib/follow-up.ts';
  import { formatDate } from '../lib/format.ts';

  let { job, onSaved }: { job: Job; onSaved: (message: string) => void } = $props();

  let dialog: HTMLDialogElement;
  let on = $state('');
  let note = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);
  let dateInput = $state<HTMLInputElement>();

  export function open() {
    on = job.followUpOn ?? '';
    note = job.followUpNote ?? '';
    error = null;
    dialog.showModal();
  }

  async function send(date: string | null) {
    saving = true;
    error = null;
    try {
      await api.setFollowUp(job.id, { on: date, note: note.trim() || null });
      dialog.close();
      onSaved(date ? `Follow-up saved for ${formatDate(date)}.` : 'Follow-up cleared.');
    } catch (err) {
      error = friendlyError(err);
    } finally {
      saving = false;
    }
  }

  function save() {
    if (!on) {
      // Clear is only there when a follow-up is set.
      error = job.followUpOn ? 'Pick a day, or press Clear.' : 'Pick a day.';
      dateInput?.focus();
      return;
    }
    void send(on);
  }
</script>

<dialog bind:this={dialog} aria-labelledby="follow-up-title">
  <form
    class="dialog-body"
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    <h2 id="follow-up-title">Follow up</h2>
    <div class="picks" role="group" aria-label="Quick picks">
      {#each QUICK_PICKS as pick (pick.days)}
        <button type="button" class="button quiet" onclick={() => (on = addDays(today(), pick.days))}>{pick.label}</button>
      {/each}
    </div>
    <label class="field"><span>Follow up on</span><input type="date" bind:value={on} bind:this={dateInput} /></label>
    <label class="field"><span>Reason (optional)</span><input bind:value={note} maxlength="200" placeholder="For example, chase Sam" /></label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="dialog-actions">
      {#if job.followUpOn}
        <button type="button" class="button quiet clear" disabled={saving} onclick={() => send(null)}>Clear</button>
      {/if}
      <button type="button" class="button quiet" onclick={() => dialog.close()}>Cancel</button>
      <button type="submit" class="button primary" disabled={saving}>Save</button>
    </div>
  </form>
</dialog>

<style>
  .picks {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .clear {
    margin-right: auto;
  }
</style>
