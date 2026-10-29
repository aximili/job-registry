<script lang="ts">
  // The home page's "Follow up" list: jobs due today or late, then the next
  // 7 days. It shows only when there's something in it (or you've just
  // cleared the last one, so the focus has somewhere to go).
  import { onMount, tick } from 'svelte';
  import type { FollowUpsResponse, JobSummary } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { lateness } from '../lib/follow-up.ts';
  import { displayCompany, displayTitle, formatDate } from '../lib/format.ts';
  import { JOB_EVENTS, onLive, onReconnect } from '../lib/live.svelte.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  let list = $state<FollowUpsResponse | null>(null);
  let cleared = $state(false);
  let error = $state<string | null>(null);
  let heading = $state<HTMLHeadingElement>();

  const count = $derived(list ? list.due.length + list.soon.length : 0);
  const name = (job: JobSummary) => `${displayTitle(job.title)} at ${displayCompany(job.company ?? job.agency)}`;

  async function load() {
    try {
      list = await api.followUps();
      error = null;
    } catch (err) {
      error = friendlyError(err);
    }
  }

  onMount(() => {
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onLive(JOB_EVENTS, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 300);
    });
    const offReconnect = onReconnect(() => void load());
    return () => {
      clearTimeout(timer);
      off();
      offReconnect();
    };
  });

  async function done(job: JobSummary) {
    const order = list ? [...list.due, ...list.soon] : [];
    const at = order.findIndex((j) => j.id === job.id);
    try {
      await api.setFollowUp(job.id, { on: null });
    } catch (err) {
      error = friendlyError(err);
      return;
    }
    if (list) list = { ...list, due: list.due.filter((j) => j.id !== job.id), soon: list.soon.filter((j) => j.id !== job.id) };
    cleared = true;
    showToast(`Done: ${name(job)}.`);
    await tick();
    const rest = order.filter((j) => j.id !== job.id);
    const next = rest[Math.min(at, rest.length - 1)];
    const target = next ? document.getElementById(`follow-up-done-${next.id}`) : heading;
    target?.focus();
  }
</script>

{#if count > 0 || cleared || error}
  <section class="follow-ups" aria-labelledby="follow-ups-heading">
    <h2 id="follow-ups-heading" tabindex="-1" bind:this={heading}>Follow up</h2>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if list && count === 0}<p class="muted">Nothing to follow up.</p>{/if}
    {#if list}
      {#each [{ title: 'Due', jobs: list.due }, { title: 'Coming up', jobs: list.soon }] as group (group.title)}
        {#if group.jobs.length > 0}
          <h3>{group.title}</h3>
          <ul>
            {#each group.jobs as job (job.id)}
              <li>
                <a href="/jobs/{job.id}">{name(job)}</a>
                {#if job.followUpNote}<span class="muted">{job.followUpNote}</span>{/if}
                <span class="when" class:late={group.title === 'Due'}>
                  {group.title === 'Due' ? lateness(job.followUpOn!, list.today) : formatDate(job.followUpOn)}
                </span>
                <button
                  type="button"
                  class="button quiet"
                  id="follow-up-done-{job.id}"
                  aria-label="Done: {name(job)}"
                  onclick={() => done(job)}>Done</button
                >
              </li>
            {/each}
          </ul>
        {/if}
      {/each}
    {/if}
  </section>
{/if}

<style>
  .follow-ups {
    margin-bottom: var(--space-5);
    padding: var(--space-4);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--sheet);
  }

  h2 {
    margin: 0 0 var(--space-2);
  }

  h2:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  h3 {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--step--1);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-2);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .when {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  .when.late {
    color: var(--danger);
    font-weight: 600;
  }
</style>
