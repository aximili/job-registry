<script lang="ts">
  // The toolbar popup (also Alt+Shift+J): whether Job Registry is running,
  // and "Save this page" for job ads on any other site.
  import { onMount } from 'svelte';
  import type { Candidate, Capture, SaveDecision } from '../../../shared/contracts/index.ts';
  import { ask } from '../messages.ts';
  import { likelyText, savedText } from '../panel/text.ts';

  type Stage =
    | { kind: 'idle' }
    | { kind: 'reading' }
    | { kind: 'ready'; capture: Capture }
    | { kind: 'likely'; capture: Capture; candidates: Candidate[] }
    | { kind: 'saving' }
    | { kind: 'saved'; text: string; jobId: number }
    | { kind: 'error'; message: string };

  let connected = $state<boolean | null>(null);
  let connection = $state('');
  let stage = $state<Stage>({ kind: 'idle' });
  let status = $state('saved');
  let note = $state('');

  async function connect() {
    connected = null;
    const res = await ask({ type: 'health' });
    connected = res.ok;
    connection = res.ok ? 'Connected to Job Registry.' : res.error;
  }

  onMount(() => void connect());

  async function read() {
    stage = { kind: 'reading' };
    const res = await ask({ type: 'captureActiveTab' });
    if (!res.ok) stage = { kind: 'error', message: res.error };
    else if (!res.data || !res.data.jdText.trim()) stage = { kind: 'error', message: "Couldn't find a job ad on this page. Select the ad text, then try again." };
    else stage = { kind: 'ready', capture: res.data };
  }

  async function save(capture: Capture, decision?: SaveDecision) {
    stage = { kind: 'saving' };
    const res = await ask({ type: 'save', capture, status, note, ...(decision ? { decision } : {}) });
    if (!res.ok) {
      stage = { kind: 'error', message: res.error };
      return;
    }
    if (res.data.result === 'needs_decision') {
      stage = { kind: 'likely', capture, candidates: res.data.candidates };
      return;
    }
    stage = { kind: 'saved', text: savedText(res.data.job, new Date()), jobId: res.data.job.id };
  }

  const preview = (c: Capture) => (c.jdText.length > 300 ? `${c.jdText.slice(0, 300)}…` : c.jdText);
</script>

<main>
  <h1>Job Registry</h1>
  <p class="connection" class:bad={connected === false} role="status">{connected === null ? 'Checking…' : connection}</p>

  {#if connected === false}
    <button type="button" onclick={() => void connect()}>Try again</button>
  {:else if connected}
    {#if stage.kind === 'idle'}
      <button type="button" class="primary" onclick={read}>Save this page</button>
    {:else if stage.kind === 'reading'}
      <p role="status">Reading the page…</p>
    {:else if stage.kind === 'ready'}
      {@const capture = stage.capture}
      <p class="title"><strong>{capture.title ?? 'Untitled role'}</strong>{#if capture.company} at {capture.company}{/if}</p>
      <p class="preview">{preview(capture)}</p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void save(capture);
        }}
      >
        <label><span>Status</span>
          <select bind:value={status}><option value="saved">Saved</option><option value="applied">Applied</option></select>
        </label>
        <label><span>Note</span><textarea bind:value={note} rows="2" placeholder="Optional"></textarea></label>
        <button type="submit" class="primary">Save</button>
      </form>
    {:else if stage.kind === 'likely'}
      {@const likely = stage}
      {#each likely.candidates as c (c.jobId)}
        <p>{likelyText(c, new Date())}</p>
        <button type="button" class="primary" onclick={() => void save(likely.capture, { linkTo: c.jobId })}>Same job</button>
      {/each}
      <button type="button" onclick={() => void save(likely.capture, 'new')}>Different job</button>
    {:else if stage.kind === 'saving'}
      <p role="status">Saving…</p>
    {:else if stage.kind === 'saved'}
      {@const saved = stage}
      <p class="saved" role="status">{saved.text}</p>
      <button type="button" onclick={() => void ask({ type: 'openJob', jobId: saved.jobId })}>Open in Job Registry</button>
    {:else if stage.kind === 'error'}
      <p class="bad" role="alert">{stage.message}</p>
      <button type="button" onclick={read}>Try again</button>
    {/if}
  {/if}

  <p class="foot"><button type="button" class="link" onclick={() => chrome.runtime.openOptionsPage()}>Options</button></p>
</main>

<style>
  :global(body) {
    margin: 0;
    font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #1b2330;
    background: #ffffff;
  }

  @media (prefers-color-scheme: dark) {
    :global(body) {
      color: #e6e9ef;
      background: #161b24;
    }

    .connection,
    .preview,
    .link {
      color: #9aa6b6;
    }

    .bad {
      color: #ff8a80;
    }

    .primary {
      background: #8ea2ff;
      border-color: #8ea2ff;
      color: #0d1330;
    }

    button {
      border-color: #2c3442;
    }
  }

  main {
    width: 320px;
    padding: 12px;
    display: grid;
    gap: 10px;
  }

  h1 {
    font-size: 16px;
    margin: 0;
  }

  p {
    margin: 0;
  }

  .connection {
    color: #4e5a6a;
  }

  .bad {
    color: #b3261e;
  }

  .preview {
    max-height: 7em;
    overflow: hidden;
    white-space: pre-line;
    color: #4e5a6a;
    font-size: 12px;
  }

  form {
    display: grid;
    gap: 8px;
  }

  label {
    display: grid;
    gap: 2px;
    font-size: 12px;
  }

  button {
    font: inherit;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid #d8dde5;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .primary {
    background: #2b44d1;
    border-color: #2b44d1;
    color: #fff;
  }

  .link {
    border: none;
    padding: 0;
    text-decoration: underline;
    color: #4e5a6a;
  }

  .saved {
    font-weight: 600;
  }

  .foot {
    text-align: right;
  }
</style>
