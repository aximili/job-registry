<script lang="ts">
  // Settings → Profile and Templates: your master profile, preferences and
  // writing guides (Markdown), and the CSS templates your resumes and cover
  // letters are printed with. Each file saves on its own. When the app has a
  // newer starter guide than yours, a note offers it.
  import { onMount } from 'svelte';
  import type { GuideName, ProfileFile, ProfileFileName, StarterStatus } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { onLive, onReconnect } from '../lib/live.svelte.ts';
  import { setLeaveGuard } from '../lib/router.svelte.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import StarterNote from './StarterNote.svelte';

  type Entry = { name: ProfileFileName; label: string; hint: string; rows: number; placeholder?: string };

  // Which of the two parts Settings shows, which have changes you haven't
  // saved, and whether a newer starter guide is ready (the menu says so).
  let {
    show,
    unsavedProfile = $bindable(false),
    unsavedTemplates = $bindable(false),
    newGuide = $bindable(false),
  }: { show: 'profile' | 'templates' | null; unsavedProfile?: boolean; unsavedTemplates?: boolean; newGuide?: boolean } = $props();
  // updatedAt: the file's time when it was loaded or saved here. A save sends
  // it, so a file that changed since (answers added, a new guide) isn't saved over.
  type FileState = { text: string; saved: string; updatedAt: string | null; busy: boolean; message: string | null; error: string | null };
  type Note = { busy: boolean; error: string | null };

  const CHANGED_HERE = 'This file changed since you opened it. Copy your changes, then reload the page to see the new text.';

  const EXAMPLE = [
    '# Your Name',
    'you@example.com · 0400 000 000 · Sydney NSW · linkedin.com/in/you',
    '',
    '## Summary',
    'Two or three lines about the work you do.',
    '',
    '## Experience',
    '### Senior Engineer, Example Co (2019–2024)',
    '- What you did, and what changed because of it (with real numbers).',
    '',
    '## Skills',
    '## Education',
  ].join('\n');

  const PROFILE: Entry[] = [
    {
      name: 'master-profile',
      label: 'Master profile',
      hint: 'Everything you have done: every job, result, skill and qualification. Paste your full resume here. The AI writes only from this, and the fact-check compares drafts with it.',
      rows: 16,
      placeholder: EXAMPLE,
    },
    {
      name: 'preferences',
      label: 'Preferences',
      hint: 'The roles you want, your salary floor, locations, work mode and deal-breakers. Used for match ratings.',
      rows: 6,
      placeholder: 'Roles: senior or lead engineer\nSalary floor: $150,000\nLocation: Sydney, or remote\nDeal-breakers: on-call every week',
    },
    { name: 'resume-guide', label: 'Resume guide', hint: 'How you want your resumes written.', rows: 8 },
    { name: 'cover-letter-guide', label: 'Cover letter guide', hint: 'How you want your cover letters written.', rows: 8 },
  ];

  const TEMPLATES: Entry[] = [
    { name: 'resume', label: 'resume.css', hint: 'How resumes look on screen and when printed. A sent resume keeps the template it was sent with.', rows: 12 },
    { name: 'cover-letter', label: 'cover-letter.css', hint: 'How cover letters look on screen and when printed.', rows: 12 },
  ];

  let files = $state<Partial<Record<ProfileFileName, FileState>>>({});
  let loadError = $state<string | null>(null);
  // The guides with a newer starter ready, and each note's own state.
  let starters = $state<StarterStatus[]>([]);
  let notes = $state<Partial<Record<GuideName, Note>>>({});
  const newer = $derived(starters.filter((s) => s.state === 'newer'));
  const entryOf = (name: ProfileFileName) => [...PROFILE, ...TEMPLATES].find((e) => e.name === name)!;

  // Files with changes you haven't saved, by label.
  function unsaved(entries: Entry[] = [...PROFILE, ...TEMPLATES]): string[] {
    return entries
      .filter((e) => {
        const state = files[e.name];
        return state !== undefined && state.text !== state.saved;
      })
      .map((e) => e.label);
  }

  $effect(() => {
    unsavedProfile = unsaved(PROFILE).length > 0;
    unsavedTemplates = unsaved(TEMPLATES).length > 0;
    newGuide = newer.length > 0;
  });

  onMount(() => {
    setLeaveGuard(() => {
      const names = unsaved();
      return names.length > 0 ? `Some files are not saved yet: ${names.join(', ')}. Leave this page anyway?` : null;
    });
    const warn = (event: BeforeUnloadEvent) => {
      if (unsaved().length > 0) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    void load();
    void loadStarters();
    // A file changed: answers added to your profile, a guide used, or a save
    // in another tab. Each tab skips the echo of its own save.
    const off = onLive(['profile.changed'], (_name, payload) => {
      const { name } = payload as { name: ProfileFileName };
      void refresh(name);
      if (name === 'resume-guide' || name === 'cover-letter-guide') void loadStarters();
    });
    const offReconnect = onReconnect(() => {
      for (const e of [...PROFILE, ...TEMPLATES]) void refresh(e.name);
      void loadStarters();
    });
    return () => {
      setLeaveGuard(null);
      window.removeEventListener('beforeunload', warn);
      off();
      offReconnect();
    };
  });

  const loaded = (f: ProfileFile): FileState => ({ text: f.text, saved: f.text, updatedAt: f.updatedAt, busy: false, message: null, error: null });

  async function load() {
    try {
      const all = await Promise.all([...PROFILE, ...TEMPLATES].map((e) => api.getProfileFile(e.name)));
      for (const f of all) files[f.name] = loaded(f);
    } catch (err) {
      loadError = friendlyError(err);
    }
  }

  // Only a hint: without it, the editors still work.
  async function loadStarters() {
    try {
      starters = await api.starters();
    } catch {
      // The next change or reconnect tries again.
    }
  }

  // The file as it is now. With no unsaved changes, the editor takes it;
  // with some, it says the file changed, and keeps what you typed.
  async function refresh(name: ProfileFileName) {
    let now: ProfileFile;
    try {
      now = await api.getProfileFile(name);
    } catch {
      return;
    }
    const state = files[name];
    // A save in flight brings back the newest time itself.
    if (!state || state.busy || now.updatedAt === state.updatedAt) return;
    if (state.text === state.saved) {
      files[name] = loaded(now);
    } else if (state.text === now.text) {
      state.saved = now.text;
      state.updatedAt = now.updatedAt;
    } else {
      state.message = null;
      state.error = CHANGED_HERE;
    }
  }

  async function save(entry: Entry) {
    const state = files[entry.name];
    if (!state) return;
    state.busy = true;
    state.error = null;
    state.message = null;
    try {
      // A 409 says the file changed since: its sentence shows below.
      const saved = await api.putProfileFile(entry.name, state.text, state.updatedAt);
      state.saved = saved.text;
      state.text = saved.text;
      state.updatedAt = saved.updatedAt;
      state.message = 'Saved.';
    } catch (err) {
      state.error = friendlyError(err);
    } finally {
      state.busy = false;
    }
  }

  // Back to the guide's editor, once its note has gone.
  const focusEditor = (name: GuideName) => requestAnimationFrame(() => document.getElementById(`file-${name}`)?.focus());

  async function useStarter(name: GuideName) {
    const entry = entryOf(name);
    const label = entry.label.toLowerCase();
    const state = files[name];
    if (state && state.text !== state.saved && !confirm(`Your ${label} has changes you haven't saved. Use the new guide anyway? Your unsaved changes will be lost.`)) return;
    notes[name] = { busy: true, error: null };
    const note = notes[name]!;
    try {
      const guide = await api.starterAction(name, 'use');
      files[name] = loaded(guide);
      starters = starters.map((s) => (s.name === name ? { name, state: 'same', diff: null } : s));
      showToast(`Now using the new ${label}. Your old one is kept in the profile folder, under old-versions.`);
      focusEditor(name);
    } catch (err) {
      note.error = friendlyError(err);
    } finally {
      note.busy = false;
    }
  }

  async function keepMine(name: GuideName) {
    notes[name] = { busy: true, error: null };
    const note = notes[name]!;
    try {
      const status = await api.starterAction(name, 'keep');
      starters = starters.map((s) => (s.name === name ? status : s));
      focusEditor(name);
    } catch (err) {
      note.error = friendlyError(err);
    } finally {
      note.busy = false;
    }
  }
</script>

{#snippet editor(entry: Entry)}
  {@const state = files[entry.name]}
  {#if state}
    <div class="file">
      <label class="field">
        <span>{entry.label}</span>
        <textarea
          id="file-{entry.name}"
          class="mono"
          rows={entry.rows}
          spellcheck={entry.name !== 'resume' && entry.name !== 'cover-letter'}
          placeholder={entry.placeholder}
          bind:value={state.text}
          oninput={() => (state.message = null)}
        ></textarea>
      </label>
      <p class="muted hint">{entry.hint}</p>
      <div class="row">
        <button
          type="button"
          class="button"
          aria-label="Save {entry.label.toLowerCase()}"
          disabled={state.busy || state.text === state.saved}
          onclick={() => save(entry)}>Save</button
        >
        {#if state.message}<span class="muted" role="status">{state.message}</span>{/if}
        {#if state.error}<span class="error" role="alert">{state.error}</span>{/if}
      </div>
    </div>
  {/if}
{/snippet}

<section id="profile" aria-labelledby="profile-heading" hidden={show !== 'profile'}>
  <h2 id="profile-heading" tabindex="-1">Profile</h2>
  <p class="muted intro">
    These files stay on this computer, in the <code>profile</code> folder. You can also edit them in any text editor.
  </p>
  {#if loadError}<p class="error" role="alert">{loadError}</p>{/if}
  {#each newer as status (status.name)}
    <StarterNote
      {status}
      label={entryOf(status.name).label}
      busy={notes[status.name]?.busy ?? false}
      error={notes[status.name]?.error ?? null}
      onuse={() => useStarter(status.name)}
      onkeep={() => keepMine(status.name)}
    />
  {/each}
  {#each PROFILE as entry (entry.name)}{@render editor(entry)}{/each}
</section>

<section id="templates" aria-labelledby="templates-heading" hidden={show !== 'templates'}>
  <h2 id="templates-heading" tabindex="-1">Templates</h2>
  <p class="muted intro">
    The page style for resumes and cover letters, in CSS. They live in the <code>templates</code> folder.
  </p>
  {#each TEMPLATES as entry (entry.name)}{@render editor(entry)}{/each}
</section>

<style>
  section {
    display: grid;
    gap: var(--space-4);
  }

  h2 {
    font-size: var(--step-1);
  }

  .intro {
    max-width: 65ch;
  }

  .file {
    display: grid;
    gap: var(--space-2);
  }

  .file textarea {
    width: 100%;
    box-sizing: border-box;
  }

  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: var(--step--1);
  }

  .hint {
    font-size: var(--step--1);
    margin: 0;
    max-width: 65ch;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
</style>
