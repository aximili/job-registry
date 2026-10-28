<script lang="ts">
  // The extension's options: where Job Registry is, and automatic ratings.
  import { onMount } from 'svelte';
  import { HOST_ORIGINS, checkServerUrl, loadSettings, saveSettings } from '../settings.ts';

  let serverUrl = $state('');
  let access = $state<boolean | null>(null);
  let autoRate = $state(true);
  let message = $state('');
  let error = $state('');

  onMount(async () => {
    const s = await loadSettings();
    serverUrl = s.serverUrl;
    autoRate = s.autoRate;
    access = await chrome.permissions.contains({ origins: HOST_ORIGINS });
  });

  // The browser asks you to confirm. It's the one permission the extension
  // needs to talk to Job Registry on this computer.
  async function allow() {
    access = await chrome.permissions.request({ origins: HOST_ORIGINS });
    message = access ? 'Allowed.' : '';
  }

  async function saveServer() {
    const checked = checkServerUrl(serverUrl);
    if (!checked.ok) {
      error = checked.error;
      message = '';
      return;
    }
    error = '';
    serverUrl = checked.value;
    await saveSettings({ serverUrl: checked.value });
    message = 'Saved.';
  }

  async function saveAutoRate() {
    await saveSettings({ autoRate });
    message = 'Saved.';
  }
</script>

<main>
  <h1>Job Registry options</h1>
  {#if access === false}
    <div class="warn" role="alert">
      <p>The extension isn't allowed to reach Job Registry on this computer, so it can't save jobs.</p>
      <button type="button" onclick={allow}>Allow access</button>
    </div>
  {/if}
  <label>
    <span>Server address</span>
    <input bind:value={serverUrl} onchange={saveServer} spellcheck="false" aria-describedby="server-hint" />
  </label>
  <p id="server-hint" class="hint">Where Job Registry runs on this computer. Usually http://127.0.0.1:4777.</p>
  {#if error}<p class="bad" role="alert">{error}</p>{/if}
  <label class="check"><input type="checkbox" bind:checked={autoRate} onchange={saveAutoRate} /> Rate jobs automatically on job pages</label>
  <p class="hint">Ratings use your master profile in Job Registry. Turn this off to rate nothing until you save a job.</p>
  <p role="status">{message}</p>
</main>

<style>
  main {
    max-width: 32rem;
    padding: 16px;
    font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    display: grid;
    gap: 8px;
  }

  h1 {
    font-size: 18px;
    margin: 0 0 8px;
  }

  label {
    display: grid;
    gap: 4px;
  }

  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
  }

  input:not([type='checkbox']) {
    font: inherit;
    padding: 4px 6px;
  }

  p {
    margin: 0;
  }

  .hint {
    color: #4e5a6a;
    font-size: 12px;
  }

  .bad {
    color: #b3261e;
  }

  .warn {
    display: grid;
    gap: 6px;
    padding: 8px 10px;
    border-left: 3px solid #b3261e;
    background: rgb(179 38 30 / 0.08);
  }

  .warn button {
    justify-self: start;
    font: inherit;
  }
</style>
