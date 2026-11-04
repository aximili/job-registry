<script lang="ts">
  // "Get ready": a plan for the interview, made by the writing AI from the
  // ad and your master profile. One button makes it. The newest plan shows,
  // in five parts; New plan makes another, and the earlier ones stay, by
  // date, so any one opens again.
  import { onMount, tick } from 'svelte';
  import { writingAi, type PrepPlan } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { app } from '../lib/app-state.svelte.ts';
  import { clock } from '../lib/brief.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { onLive, onReconnect } from '../lib/live.svelte.ts';
  import { hoursText, planDate, planProgressText, learnSummary, shownPlan, type PlanProgress } from '../lib/prep.ts';
  import WriterLine from './WriterLine.svelte';

  let { jobId }: { jobId: number } = $props();

  let plans = $state<PrepPlan[]>([]);
  let loaded = $state(false);
  // The earlier plan you opened, or null for the newest.
  let openId = $state<number | null>(null);
  let running = $state<(PlanProgress & { since: number }) | null>(null);
  let now = $state(Date.now());
  let error = $state<string | null>(null);
  let heading = $state<HTMLHeadingElement>();
  let startButton = $state<HTMLButtonElement>();
  let controller: AbortController | null = null;

  const plan = $derived(shownPlan(plans, openId));
  const isNewest = $derived(plan !== null && plan.id === plans[0]?.id);
  const earlier = $derived(plans.slice(1));

  // The job page's Esc waits while a plan is being made: Cancel stops it.
  export function isMaking(): boolean {
    return running !== null;
  }

  async function load() {
    try {
      plans = (await api.prepPlans(jobId)).plans;
      loaded = true;
    } catch (err) {
      error = friendlyError(err);
    }
  }

  onMount(() => {
    void load();
    // A plan made in another tab, or the echo of this tab's own: either way
    // the list is read again, which is cheap and always right.
    const off = onLive(['prep.saved'], (_name, payload) => {
      if ((payload as { jobId?: number }).jobId === jobId) void load();
    });
    const offReconnect = onReconnect(() => void load());
    // Leaving while a plan is being made asks first.
    const warn = (event: BeforeUnloadEvent) => {
      if (running) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      off();
      offReconnect();
      window.removeEventListener('beforeunload', warn);
      controller?.abort();
    };
  });

  // The clock beside the progress line ticks while the AI works.
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  async function make() {
    if (running) return;
    controller = new AbortController();
    const signal = controller.signal;
    error = null;
    now = Date.now();
    running = { phase: 'waiting', by: writingAi(app.settings.ai).ai.name, since: now };
    let done = false;
    try {
      for await (const line of api.makePrepPlan(jobId, { signal })) {
        if (line.kind === 'waiting') running = { phase: 'waiting', by: line.by, since: Date.now() };
        else if (line.kind === 'working') running = { phase: 'working', by: line.by, since: Date.now() };
        else if (line.kind === 'done') {
          plans = [line.plan, ...plans.filter((p) => p.id !== line.plan.id)];
          openId = null;
          done = true;
        } else error = line.message;
      }
    } catch (err) {
      if (!signal.aborted) error = friendlyError(err);
    } finally {
      running = null;
      controller = null;
    }
    await tick();
    if (done) heading?.focus();
    else if (signal.aborted) startButton?.focus();
  }

  function cancel() {
    controller?.abort();
  }

  async function open(id: number | null) {
    openId = id;
    await tick();
    heading?.focus();
  }
</script>

{#snippet progress()}
  <div class="progress-row">
    <!-- Always on the page, so a screen reader hears each change. -->
    <p class="progress" aria-live="polite">{running ? planProgressText(running) : ''}</p>
    {#if running}
      {#if running.phase === 'working'}<span class="numeric timer" role="timer">{clock(now - running.since)}</span>{/if}
      <button type="button" class="button" onclick={cancel}>Cancel</button>
    {/if}
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{/snippet}

<section class="prep" aria-labelledby="prep-heading">
  <header class="head">
    <div>
      <h2 id="prep-heading" tabindex="-1" bind:this={heading}>Get ready</h2>
      {#if plan}
        <p class="meta">Made by {plan.by ?? 'the AI'}, {planDate(plan.createdAt)}</p>
      {/if}
    </div>
    {#if plan}
      <div class="actions">
        <button type="button" class="button" bind:this={startButton} aria-disabled={running ? 'true' : undefined} onclick={make}>New plan</button>
        <WriterLine />
      </div>
    {/if}
  </header>

  {#if !loaded && !error}
    <p class="muted">Loading…</p>
  {:else if !plan}
    <p class="intro">
      A plan for the interview, from the ad and your master profile: what to learn in a day, a project to build, the questions they'll
      likely ask, and what to ask them.
    </p>
    <div class="actions">
      <button type="button" class="button primary" bind:this={startButton} aria-disabled={running ? 'true' : undefined} onclick={make}>Get ready</button>
      <WriterLine />
    </div>
    {@render progress()}
  {:else}
    {@render progress()}

    {#if earlier.length > 0}
      <nav class="earlier" aria-labelledby="earlier-heading">
        <h3 id="earlier-heading" class="small-head">Earlier plans</h3>
        <ul>
          {#each earlier as p (p.id)}
            <li>
              <button type="button" class="link" aria-current={p.id === plan.id ? 'true' : undefined} onclick={() => open(p.id)}>{planDate(p.createdAt)}</button>
            </li>
          {/each}
        </ul>
      </nav>
    {/if}
    {#if !isNewest}
      <p class="older">
        This is an earlier plan.
        <button type="button" class="link" onclick={() => open(null)}>Show the newest</button>
      </p>
    {/if}

    <div class="parts">
      <section class="part learn" aria-labelledby="prep-learn">
        <div class="part-head">
          <h3 id="prep-learn"><span class="num" aria-hidden="true">1</span> Learn in a day</h3>
          {#if plan.learn.length > 0}<span class="sum">{learnSummary(plan)}</span>{/if}
        </div>
        {#if plan.learn.length === 0}
          <p class="muted">Nothing to learn this time: your profile covers the ad's must-haves.</p>
        {:else}
          <ol class="topics">
            {#each plan.learn as topic, i (i)}
              <li class="topic">
                <h4 class="item-head"><span>{topic.topic}</span> <span class="hours">{hoursText(topic.hours)}</span></h4>
                <p>{topic.why}</p>
                <!-- A topic whose steps were only links has one step, or none. -->
                {#if topic.steps.length > 0}
                  <ol class="steps">
                    {#each topic.steps as step, j (j)}<li>{step}</li>{/each}
                  </ol>
                {/if}
                <p class="after"><span class="label">Afterwards you can say:</span> “{topic.afterwards}”</p>
              </li>
            {/each}
          </ol>
        {/if}
      </section>

      <section class="part" aria-labelledby="prep-project">
        <div class="part-head"><h3 id="prep-project"><span class="num" aria-hidden="true">2</span> A practice project</h3></div>
        <h4 class="item-head"><span>{plan.project.title}</span> <span class="hours">{hoursText(plan.project.hours)}</span></h4>
        <p>{plan.project.what}</p>
        {#if plan.project.touches.length > 0}
          <p class="touches"><span class="label">It touches:</span> {plan.project.touches.join(' · ')}</p>
        {/if}
        <p class="after"><span class="label">Afterwards you can say:</span> “{plan.project.afterwards}”</p>
      </section>

      <section class="part" aria-labelledby="prep-interview">
        <div class="part-head"><h3 id="prep-interview"><span class="num" aria-hidden="true">3</span> Likely interview questions</h3></div>
        {#if plan.interview.length === 0}
          <p class="muted">None this time.</p>
        {:else}
          <ol class="pairs">
            {#each plan.interview as q, i (i)}
              <li><p class="q">{q.question}</p><p class="a"><span class="label">Your story:</span> {q.story}</p></li>
            {/each}
          </ol>
        {/if}
      </section>

      <section class="part" aria-labelledby="prep-ask">
        <div class="part-head"><h3 id="prep-ask"><span class="num" aria-hidden="true">4</span> Questions to ask them</h3></div>
        {#if plan.ask.length === 0}
          <p class="muted">None this time.</p>
        {:else}
          <ol class="pairs">
            {#each plan.ask as q, i (i)}
              <li><p class="q">{q.question}</p><p class="a muted">{q.why}</p></li>
            {/each}
          </ol>
        {/if}
      </section>

      <section class="part" aria-labelledby="prep-refresh">
        <div class="part-head"><h3 id="prep-refresh"><span class="num" aria-hidden="true">5</span> Refresh before the interview</h3></div>
        {#if plan.refresh.length === 0}
          <p class="muted">Nothing to refresh this time.</p>
        {:else}
          <ul class="pairs">
            {#each plan.refresh as r, i (i)}
              <li><p class="q">{r.item}</p><p class="a muted">{r.why}</p></li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  {/if}
</section>

<style>
  .prep {
    margin-top: var(--space-6);
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: var(--space-5);
  }

  .prep > * + * {
    margin-top: var(--space-4);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3) var(--space-5);
  }

  h2 {
    font-size: var(--step-1);
  }

  h2:focus {
    outline: none;
  }

  h2:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .meta {
    margin: var(--space-1) 0 0;
    font-size: var(--step--1);
    color: var(--ink-2);
  }

  .intro {
    margin-bottom: 0;
    max-width: 60ch;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .progress-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-3);
  }

  /* Idle, the line takes no room, but stays on the page for screen readers. */
  .prep > .progress-row:has(.progress:empty) {
    margin-top: 0;
  }

  .progress {
    margin: 0;
    font-weight: 700;
  }

  .timer {
    color: var(--ink-2);
    font-weight: 600;
  }

  .error {
    margin-bottom: 0;
  }

  .small-head {
    font-size: var(--step--1);
    color: var(--ink-2);
    margin: 0;
  }

  .earlier {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-3);
  }

  .earlier ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .link {
    font: inherit;
    font-size: var(--step--1);
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
  }

  .link[aria-current='true'] {
    color: var(--ink);
    font-weight: 700;
    text-decoration: none;
  }

  .older {
    margin-bottom: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--accent-soft);
    border-radius: var(--radius);
    font-size: var(--step--1);
  }

  .label {
    font-weight: 700;
    color: var(--ink-2);
  }

  .item-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
    font-size: var(--step-0);
    margin: 0 0 var(--space-1);
  }

  .hours {
    font-size: var(--step--1);
    font-weight: 600;
    color: var(--ink-2);
    white-space: nowrap;
  }

  p {
    margin: 0 0 var(--space-2);
  }

  .topics,
  .pairs {
    display: grid;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .steps {
    margin: 0 0 var(--space-2);
    padding-left: var(--space-5);
  }

  .steps li + li {
    margin-top: var(--space-1);
  }

  .after,
  .touches {
    font-size: var(--step--1);
  }

  .pairs .q {
    font-weight: 700;
    margin-bottom: var(--space-1);
  }

  .pairs .a {
    margin: 0;
  }

  /* One sheet, every part open, in two columns. */
  .parts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-5) var(--space-6);
  }

  .part {
    border-top: 2px solid var(--ink);
    padding-top: var(--space-3);
  }

  .part-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    margin: 0 0 var(--space-3);
  }

  .part h3 {
    font-size: var(--step-1);
    margin: 0;
  }

  .num {
    color: var(--accent);
  }

  .sum {
    font-size: var(--step--1);
    font-weight: 600;
    color: var(--ink-2);
  }

  /* Learn in a day runs across the sheet, its topics side by side. */
  .part.learn {
    grid-column: 1 / -1;
  }

  .part.learn .topics {
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: var(--space-4) var(--space-5);
  }

  .part.learn .topic + .topic {
    border-left: 1px solid var(--rule);
    padding-left: var(--space-5);
  }

  @media (max-width: 48rem) {
    .parts {
      grid-template-columns: 1fr;
    }
  }
</style>
