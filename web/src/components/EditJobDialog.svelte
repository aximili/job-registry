<script lang="ts">
  // Edit a job's fields. The form is taken when the dialog opens and isn't
  // replaced while it's open, even if the AI updates the job meanwhile.
  // Saving sends only the fields you changed.
  import type { EmploymentType, Job, WorkMode } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { buildPatch, emptyForm, formFromJob, type EditForm } from '../lib/edit-job.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { EMPLOYMENT_LABEL, WORK_MODE_LABEL } from '../lib/format.ts';

  let { job, onSaved }: { job: Job; onSaved: () => void } = $props();

  let dialog: HTMLDialogElement;
  // Taken when the dialog opens: what you saw, so only your changes are sent.
  let start: EditForm = emptyForm();
  let opened: Job | null = null;
  let form = $state<EditForm>(emptyForm());
  let saving = $state(false);
  let error = $state<string | null>(null);

  export function open() {
    opened = job;
    start = formFromJob(job);
    form = { ...start };
    error = null;
    dialog.showModal();
  }

  async function save() {
    if (!opened) return;
    const patch = buildPatch(start, form, opened);
    if (Object.keys(patch).length === 0) {
      dialog.close();
      return;
    }
    saving = true;
    try {
      await api.updateJob(opened.id, patch);
      dialog.close();
      onSaved();
    } catch (err) {
      error = friendlyError(err);
    } finally {
      saving = false;
    }
  }

  const WORK_MODES = Object.keys(WORK_MODE_LABEL) as WorkMode[];
  const EMPLOYMENT = Object.keys(EMPLOYMENT_LABEL) as EmploymentType[];
</script>

<dialog bind:this={dialog} aria-labelledby="edit-job-title">
  <form
    class="dialog-body"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <h2 id="edit-job-title">Edit job</h2>
    <div class="grid">
      <label class="field wide"><span>Role</span><input bind:value={form.title} /></label>
      <label class="field"><span>Company</span><input bind:value={form.company} /></label>
      <label class="field"><span>Agency</span><input bind:value={form.agency} placeholder="If a recruiter posted it" /></label>
      <label class="field"><span>Location</span><input bind:value={form.location} /></label>
      <label class="field"><span>Salary</span><input bind:value={form.salary} placeholder="For example, $150k–$170k + super" /></label>
      <label class="field">
        <span>Work mode</span>
        <select bind:value={form.workMode}>
          {#each WORK_MODES as mode (mode)}<option value={mode}>{WORK_MODE_LABEL[mode] || 'Not known'}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>Employment type</span>
        <select bind:value={form.employmentType}>
          {#each EMPLOYMENT as type (type)}<option value={type}>{EMPLOYMENT_LABEL[type] || 'Not known'}</option>{/each}
        </select>
      </label>
      <label class="field"><span>Date applied</span><input type="date" bind:value={form.dateApplied} /></label>
      <label class="field"><span>Closing date</span><input type="date" bind:value={form.closingDate} /></label>
      <label class="field wide"><span>Summary</span><textarea rows="2" bind:value={form.summary}></textarea></label>
      <label class="field wide">
        <span>Key requirements, one per line</span>
        <textarea rows="4" bind:value={form.requirements}></textarea>
      </label>
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="dialog-actions">
      <button type="button" class="button" onclick={() => dialog.close()}>Cancel</button>
      <button type="submit" class="button primary" disabled={saving}>Save changes</button>
    </div>
  </form>
</dialog>

<style>
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
</style>
