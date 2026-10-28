<script lang="ts">
  import type { JobContact, Relation } from '../../../shared/contracts/index.ts';
  import { formatRelative } from '../lib/format.ts';

  let { people, onLogCall }: { people: JobContact[]; onLogCall: () => void } = $props();

  const RELATION: Record<Relation, string> = {
    recruiter: 'Recruiter',
    hiring_manager: 'Hiring manager',
    referrer: 'Referrer',
    other: '',
  };
</script>

<section aria-labelledby="people-heading" class="panel">
  <div class="panel-head">
    <h2 id="people-heading">People</h2>
    <button type="button" class="button" onclick={onLogCall}>Log call <kbd>L</kbd></button>
  </div>
  {#if people.length === 0}
    <p class="muted">No one yet. Log a call to add the person you spoke with.</p>
  {:else}
    <ul>
      {#each people as person (person.id)}
        <li>
          <strong>{person.name}</strong>
          {#if person.role || person.organisation || RELATION[person.relation]}
            <span class="muted">{[person.role ?? RELATION[person.relation], person.organisation].filter(Boolean).join(', ')}</span>
          {/if}
          <span class="contact">
            {#if person.phone}<a href="tel:{person.phone.replace(/[^\d+]/g, '')}" class="numeric">{person.phone}</a>{/if}
            {#if person.email}<a href="mailto:{person.email}">{person.email}</a>{/if}
          </span>
          {#if person.lastInteractionAt}
            <span class="muted small">Last spoke {formatRelative(person.lastInteractionAt)}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }

  li {
    display: grid;
    gap: 0.1rem;
  }

  .contact {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .small {
    font-size: var(--step--1);
  }
</style>
