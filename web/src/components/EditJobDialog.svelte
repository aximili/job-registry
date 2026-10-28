<script lang="ts">
  import type { EmploymentType, Job, UpdateJobRequest, WorkMode } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { EMPLOYMENT_LABEL, WORK_MODE_LABEL } from '../lib/format.ts';

  let { job, onSaved }: { job: Job; onSaved: () => void } = $props();

  let dialog: HTMLDialogElement;
  let form = $state(fromJob());
  let saving = $state(false);
  let error = $state<string | null>(null);

  function fromJob() {
    return {
      title: job.title ?? '',
      company: job.company ?? '',
      agency: job.agency ?? '',
      location: job.location ?? '',
      workMode: job.workMode,
      employmentType: job.employmentType,
      salary: job.salary.text ?? '',
      closingDate: job.closingDate ?? '',
      dateApplied: job.dateApplied ?? '',
      summary: job.summary ?? '',
      requirements: job.requirements.join('\n'),
    };
  }

  export function open() {
    form = fromJob();
    error = null;
    dialog.showModal();
  }

  async function save() {
    saving = true;
    const lines = (text: string) =>
      text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    // The server keeps only the values that really changed.
    const patch: UpdateJobRequest = {
      title: form.title,
      company: form.company,
      agency: form.agency,
      location: form.location,
      workMode: form.workMode,
      employmentType: form.employmentType,
      salary: { ...job.salary, text: form.salary.trim() || null },
      closingDate: form.closingDate || null,
      dateApplied: form.dateApplied || null,
      summary: form.summary,
      requirements: lines(form.requirements),
    };
    try {
      await api.updateJob(job.id, patch);
      dialog.close();
      onSaved();
    } catch (err) {
      error = (err as Error).message;
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
    {#if error}<p class="error">{error}</p>{/if}
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
