<script lang="ts">
  // Settings → Email: turn on reading Gmail, your address, the app password
  // and a button to check Gmail answers. The password is saved on its own and
  // never comes back to the browser: the page only learns whether one is set.
  import { onMount, tick } from 'svelte';
  import type { EmailSettings } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { app, loadSettings } from '../lib/app-state.svelte.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  type Form = { enabled: boolean; address: string; pollMinutes: number };

  let base: EmailSettings | null = null;
  let saved = '';
  let form = $state<Form>({ enabled: false, address: '', pollMinutes: 10 });
  let ready = $state(false);
  let busy = $state(false);
  let testing = $state(false);
  let result = $state<{ ok: boolean; text: string } | null>(null);
  let error = $state<string | null>(null);

  let passwordSet = $state(false);
  let replacing = $state(false);
  let password = $state('');
  let passwordBusy = $state(false);
  let passwordError = $state<string | null>(null);
  let passwordInput = $state<HTMLInputElement>();
  let replaceButton = $state<HTMLButtonElement>();

  // A password typed into the field but not saved yet.
  const typedPassword = () => (!passwordSet || replacing) && password.trim() !== '';

  function take(email: EmailSettings) {
    base = email;
    form = { enabled: email.enabled, address: email.address, pollMinutes: email.pollMinutes };
    saved = JSON.stringify(form);
  }

  onMount(() => {
    take(app.settings.email);
    ready = true;
    api
      .secretsStatus()
      .then((s) => (passwordSet = s.emailPassword))
      .catch((err: unknown) => (passwordError = friendlyError(err)));
  });

  async function persist(): Promise<void> {
    const next = await api.updateSettings({
      email: { ...base!, enabled: form.enabled, address: form.address.trim(), pollMinutes: Number(form.pollMinutes) },
    });
    await loadSettings();
    take(next.email);
  }

  async function save() {
    busy = true;
    error = null;
    try {
      if (typedPassword()) await setPassword(password, { quiet: true });
      await persist();
      showToast('Email settings saved.');
    } catch (err) {
      error = friendlyError(err);
    } finally {
      busy = false;
    }
  }

  // Tests what's on screen: unsaved changes are saved first.
  async function test() {
    testing = true;
    error = null;
    result = null;
    try {
      if (typedPassword()) await setPassword(password, { quiet: true });
      if (JSON.stringify(form) !== saved) await persist();
      const res = await api.testEmail();
      result = { ok: res.ok, text: res.detail };
    } catch (err) {
      result = { ok: false, text: friendlyError(err) };
    } finally {
      testing = false;
    }
  }

  // quiet: part of Save or Test, which say how it went themselves. Those
  // keep the focus on their own button; on its own, the focus follows the
  // button that replaced the one you pressed.
  async function setPassword(value: string | null, o: { quiet?: boolean } = {}) {
    passwordBusy = true;
    passwordError = null;
    try {
      const res = await api.updateSecrets({ emailPassword: value });
      passwordSet = res.emailPassword;
      password = '';
      replacing = false;
      if (!o.quiet) {
        showToast(res.emailPassword ? 'App password saved.' : 'App password removed.');
        // A disabled button can't take the focus.
        passwordBusy = false;
        await tick();
        (res.emailPassword ? replaceButton : passwordInput)?.focus();
      }
    } catch (err) {
      // Save and Test show the reason themselves.
      if (o.quiet) throw err;
      passwordError = friendlyError(err);
    } finally {
      passwordBusy = false;
    }
  }

  async function replace() {
    replacing = true;
    await tick();
    passwordInput?.focus();
  }

  async function keep() {
    replacing = false;
    password = '';
    await tick();
    replaceButton?.focus();
  }
</script>

<section id="email" aria-labelledby="email-heading">
  <h2 id="email-heading" tabindex="-1">Email</h2>
  <p class="muted intro">
    Job Registry can read your Gmail inbox and suggest status changes from emails about your jobs. Nothing changes until you
    confirm it in the Inbox. The app only reads your inbox. It never sends, moves or deletes email.
  </p>
  <p class="muted intro">
    Gmail needs an app password, not your normal password. Turn on 2-Step Verification for your Google account, then make one
    at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a>
    and paste it here.
  </p>
  {#if ready}
    <form
      class="email-form"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label class="check wide"><input type="checkbox" bind:checked={form.enabled} /> Check Gmail for emails about your jobs</label>
      <label class="field">
        <span>Gmail address</span>
        <input type="email" bind:value={form.address} autocomplete="off" spellcheck="false" />
      </label>
      <div class="password">
        {#if passwordSet && !replacing}
          <p class="saved">An app password is saved.</p>
          <div class="actions">
            <button type="button" class="button" disabled={passwordBusy} onclick={replace} bind:this={replaceButton}>Replace</button>
            <button type="button" class="button quiet" disabled={passwordBusy} onclick={() => setPassword(null)}>Remove</button>
          </div>
        {:else}
          <label class="field">
            <span>App password</span>
            <input type="password" bind:value={password} bind:this={passwordInput} autocomplete="new-password" spellcheck="false" />
          </label>
          <div class="actions">
            <button type="button" class="button" disabled={passwordBusy || !password.trim()} onclick={() => setPassword(password)}>
              Save password
            </button>
            {#if replacing}<button type="button" class="button quiet" onclick={keep}>Cancel</button>{/if}
          </div>
        {/if}
        {#if passwordError}<p class="error" role="alert">{passwordError}</p>{/if}
      </div>
      <label class="field">
        <span>Minutes between checks</span>
        <input type="number" min="5" max="1440" bind:value={form.pollMinutes} />
      </label>
      {#if error}<p class="error wide" role="alert">{error}</p>{/if}
      <div class="actions wide">
        <button type="submit" class="button primary" disabled={busy || testing}>Save email settings</button>
        <button type="button" class="button" disabled={busy || testing} onclick={test}>{testing ? 'Testing…' : 'Test connection'}</button>
      </div>
      {#if testing || result}
        <p class="wide result" class:bad={result && !result.ok} role="status">{result?.text ?? 'Testing…'}</p>
      {/if}
    </form>
  {/if}
</section>

<style>
  h2:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .email-form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
    max-width: 44rem;
  }

  .wide {
    grid-column: 1 / -1;
  }

  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .actions {
    display: flex;
    gap: var(--space-3);
    align-items: end;
  }

  .result {
    margin: 0;
    min-height: 1.4em;
  }

  .result.bad {
    color: var(--danger);
  }

  .password {
    grid-column: 1 / -1;
    display: flex;
    gap: var(--space-3);
    align-items: end;
    flex-wrap: wrap;
  }

  .saved {
    font-weight: 600;
    margin: 0;
    align-self: center;
  }
</style>
