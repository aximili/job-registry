<script lang="ts">
  // Settings → Profile and Templates: your master profile, preferences and
  // writing guides (Markdown), and the CSS templates your resumes and cover
  // letters are printed with. Each file saves on its own.
  import { onMount } from 'svelte';
  import type { ProfileFileName } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';
  import { friendlyError } from '../lib/errors.ts';
  import { setLeaveGuard } from '../lib/router.svelte.ts';

  type Entry = { name: ProfileFileName; label: string; hint: string; rows: number; placeholder?: string };
  type FileState = { text: string; saved: string; busy: boolean; message: string | null; error: string | null };

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

  // Files with changes you haven't saved, by label.
  function unsaved(): string[] {
    return [...PROFILE, ...TEMPLATES].filter((e) => {
      const state = files[e.name];
      return state !== undefined && state.text !== state.saved;
    }).map((e) => e.label);
  }

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
    return () => {
      setLeaveGuard(null);
      window.removeEventListener('beforeunload', warn);
    };
  });

  async function load() {
    try {
      const all = await Promise.all([...PROFILE, ...TEMPLATES].map((e) => api.getProfileFile(e.name)));
      for (const f of all) files[f.name] = { text: f.text, saved: f.text, busy: false, message: null, error: null };
    } catch (err) {
      loadError = friendlyError(err);
    }
  }

  async function save(entry: Entry) {
    const state = files[entry.name];
    if (!state) return;
    state.busy = true;
    state.error = null;
    state.message = null;
    try {
      const saved = await api.putProfileFile(entry.name, state.text);
      state.saved = saved.text;
      state.text = saved.text;
      state.message = 'Saved.';
    } catch (err) {
      state.error = friendlyError(err);
    } finally {
      state.busy = false;
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

<section id="profile" aria-labelledby="profile-heading">
  <h2 id="profile-heading">Profile</h2>
  <p class="muted intro">
    These files stay on this computer, in the <code>profile</code> folder. You can also edit them in any text editor.
  </p>
  {#if loadError}<p class="error" role="alert">{loadError}</p>{/if}
  {#each PROFILE as entry (entry.name)}{@render editor(entry)}{/each}
</section>

<section id="templates" aria-labelledby="templates-heading">
  <h2 id="templates-heading">Templates</h2>
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
