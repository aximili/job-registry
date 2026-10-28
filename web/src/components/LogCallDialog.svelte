<script lang="ts">
  // Log a call in a few seconds: pick the person (or type a new name), type
  // what was said, press Ctrl+Enter. The person is linked to the job for you.
  import type { Contact, InteractionKind, JobContact } from '../../../shared/contracts/index.ts';
  import { api } from '../lib/api.ts';

  let { jobId, people, onSaved }: { jobId: number; people: JobContact[]; onSaved: () => void } = $props();

  type Pick = { kind: 'existing'; contact: Contact } | { kind: 'new'; name: string };
  type Option = { key: string; label: string; pick: Pick };

  let dialog: HTMLDialogElement;
  let personInput: HTMLInputElement;
  let query = $state('');
  let picked = $state<Pick | null>(null);
  let others = $state<Contact[]>([]);
  let active = $state(0);
  let listOpen = $state(false);
  let kind = $state<InteractionKind>('call');
  let notes = $state('');
  let details = $state({ phone: '', email: '', role: '', organisation: '' });
  let saving = $state(false);
  let error = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const options = $derived.by((): Option[] => {
    const q = query.trim().toLowerCase();
    const mine = people.filter((p) => !q || p.name.toLowerCase().includes(q));
    const rest = others.filter((c) => !people.some((p) => p.id === c.id));
    const list: Option[] = [...mine, ...rest].map((c) => ({
      key: `c${c.id}`,
      label: [c.name, c.organisation].filter(Boolean).join(', '),
      pick: { kind: 'existing', contact: c },
    }));
    const exact = [...mine, ...rest].some((c) => c.name.toLowerCase() === q);
    if (q && !exact) list.push({ key: 'new', label: `New person: ${query.trim()}`, pick: { kind: 'new', name: query.trim() } });
    return list;
  });

  export function open() {
    query = '';
    picked = null;
    others = [];
    active = 0;
    listOpen = false;
    kind = 'call';
    notes = '';
    details = { phone: '', email: '', role: '', organisation: '' };
    error = null;
    dialog.showModal();
    personInput.focus();
  }

  function onPersonInput() {
    picked = null;
    listOpen = true;
    active = 0;
    others = [];
    clearTimeout(timer);
    const q = query.trim();
    timer = setTimeout(async () => {
      const found = q ? await api.listContacts(q).catch(() => []) : [];
      // Only use the answer if you haven't typed more since asking.
      if (query.trim() === q) others = found;
    }, 120);
  }

  function choose(option: Option) {
    picked = option.pick;
    query = option.pick.kind === 'existing' ? option.pick.contact.name : option.pick.name;
    listOpen = false;
  }

  function onPersonKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && listOpen) {
      // Esc closes the suggestions first, not the whole dialog.
      event.preventDefault();
      event.stopPropagation();
      listOpen = false;
      return;
    }
    if (!listOpen || options.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = (active + 1) % options.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active - 1 + options.length) % options.length;
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      choose(options[active]!);
    }
  }

  async function save() {
    if (saving) return;
    saving = true;
    error = null;
    const name = (picked?.kind === 'new' ? picked.name : query).trim();
    // Typing the exact name of someone you already know means them, not a new person.
    const known =
      picked?.kind === 'existing'
        ? picked.contact
        : picked?.kind === 'new'
          ? undefined
          : [...people, ...others].find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
    const who = known
      ? { contactId: known.id }
      : name
          ? {
              newContact: {
                name,
                phone: details.phone || null,
                email: details.email || null,
                role: details.role || null,
                organisation: details.organisation || null,
              },
            }
          : {};
    try {
      await api.logInteraction({ ...who, jobId, kind, notes });
      dialog.close();
      onSaved();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  // Esc or the close button: ask before throwing away what you typed.
  function onCancel(event: Event) {
    if (listOpen) {
      event.preventDefault();
      listOpen = false;
      return;
    }
    if ((notes.trim() || query.trim()) && !confirm('Discard this call? What you typed will be lost.')) {
      event.preventDefault();
    }
  }

  function onDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void save();
    }
  }

  const isNew = $derived(picked?.kind === 'new');
</script>

<dialog bind:this={dialog} aria-labelledby="log-call-title" onkeydown={onDialogKeydown} oncancel={onCancel}>
  <form
    class="dialog-body"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <h2 id="log-call-title">Log a call</h2>

    <div class="field person">
      <label for="log-person"><span>Person</span></label>
      <input
        id="log-person"
        bind:this={personInput}
        bind:value={query}
        role="combobox"
        aria-expanded={listOpen && options.length > 0}
        aria-controls="log-person-options"
        aria-autocomplete="list"
        autocomplete="off"
        placeholder="Name of the person you spoke with"
        oninput={onPersonInput}
        onkeydown={onPersonKeydown}
        onfocus={() => (listOpen = !picked)}
        onblur={() => (listOpen = false)}
      />
      {#if listOpen && options.length > 0}
        <div id="log-person-options" role="listbox" aria-label="People" class="options">
          {#each options as option, i (option.key)}
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              class:active={i === active}
              tabindex="-1"
              onmousedown={(e) => e.preventDefault()}
              onclick={() => choose(option)}>{option.label}</button
            >
          {/each}
        </div>
      {/if}
    </div>

    {#if isNew}
      <div class="grid">
        <label class="field"><span>Phone</span><input bind:value={details.phone} inputmode="tel" /></label>
        <label class="field"><span>Email</span><input bind:value={details.email} type="email" /></label>
        <label class="field"><span>Role</span><input bind:value={details.role} placeholder="For example, Talent partner" /></label>
        <label class="field"><span>Organisation</span><input bind:value={details.organisation} placeholder="Agency or company" /></label>
      </div>
    {/if}

    <label class="field">
      <span>Type</span>
      <select bind:value={kind}>
        <option value="call">Call</option>
        <option value="email">Email</option>
        <option value="meeting">Meeting</option>
        <option value="message">Message</option>
      </select>
    </label>

    <label class="field">
      <span>Notes</span>
      <textarea bind:value={notes} rows="4" placeholder="What did you talk about? Ctrl+Enter saves."></textarea>
    </label>

    {#if error}<p class="error">{error}</p>{/if}

    <div class="dialog-actions">
      <button
        type="button"
        class="button"
        onclick={() => {
          const event = new Event('cancel', { cancelable: true });
          onCancel(event);
          if (!event.defaultPrevented) dialog.close();
        }}>Cancel</button
      >
      <button type="submit" class="button primary" disabled={saving}>Save</button>
    </div>
  </form>
</dialog>

<style>
  .person {
    position: relative;
  }

  .options {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 3;
    display: grid;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: var(--space-1);
    max-height: 14rem;
    overflow: auto;
  }

  .options button {
    font: inherit;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .options button.active {
    background: var(--accent-soft);
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  textarea {
    width: 100%;
  }
</style>
