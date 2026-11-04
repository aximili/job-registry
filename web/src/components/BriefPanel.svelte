<script lang="ts">
  // "Before I write": the brief you check before the AI writes, in a card
  // above the text. Who to write to, the ad's opening line, its needs side by
  // side (each with your best story, and others to swap in), your gaps, and
  // the AI's questions. Every change is one click (or what you type), and the
  // page saves it. One main button writes, beside the AI that writes; Skip,
  // just write and New brief are one click each. They stay at the foot of
  // the window while the card is on screen. Once the editor has text, the
  // card folds to one line.
  import { tick } from 'svelte';
  import { BRIEF_CAPS, type Brief, type DocumentKind } from '../../../shared/contracts/index.ts';
  import { shortDate } from '../../../shared/dates.ts';
  import { clock, progressText, writeLabel, type BriefChange, type Progress } from '../lib/brief.ts';
  import WriterLine from './WriterLine.svelte';

  type Running = Progress & { since: number };

  let {
    brief,
    kind,
    folded,
    canFold,
    making,
    writing,
    now,
    error,
    notice,
    onchange,
    onwrite,
    onskip,
    onnew,
    oncancel,
    onstop,
    onfold,
  }: {
    brief: Brief | null;
    kind: DocumentKind;
    // One line, once the editor has text.
    folded: boolean;
    // The editor has text, so the card can fold again.
    canFold: boolean;
    making: Running | null;
    writing: Running | null;
    now: number;
    error: string | null;
    notice: string | null;
    onchange: (change: BriefChange) => void;
    onwrite: () => void;
    onskip: () => void;
    onnew: () => void;
    oncancel: () => void;
    onstop: () => void;
    onfold: (folded: boolean) => void;
  } = $props();

  let heading = $state<HTMLHeadingElement>();
  let footer = $state<HTMLElement>();
  let foldButton = $state<HTMLButtonElement>();

  export function focusHeading() {
    heading?.focus();
  }

  const running = $derived(making ?? writing);
  const forLetter = $derived(kind === 'cover_letter');
  const kept = $derived(brief ? brief.needs.filter((n) => !n.dropped).length : 0);
  const answered = $derived(brief ? brief.questions.filter((q) => !q.skipped && q.answer?.trim()).length : 0);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  // "Made by Bonsai 2, 4 Nov", and once folded what it holds first.
  const meta = $derived.by(() => {
    if (!brief) return '';
    const made = `Made by ${brief.by ?? 'the AI'}, ${shortDate(brief.createdAt)}`;
    return folded ? `${plural(kept, 'need', 'needs')} · ${plural(answered, 'answer', 'answers')} · ${made}` : made;
  });

  // The button you pressed gives way to Cancel or Stop, and back: the
  // cursor moves to the first button there, never off the page.
  let wasInFooter = false;
  $effect.pre(() => {
    void running;
    wasInFooter = footer?.contains(document.activeElement) ?? false;
  });
  $effect(() => {
    void running;
    if (wasInFooter && (document.activeElement === document.body || !document.activeElement)) footer?.querySelector('button')?.focus();
  });

  // Skip gives way to Answer it, and Answer it to the answer's box: the
  // cursor goes with it.
  async function skip(i: number, skipped: boolean) {
    onchange({ kind: 'skip', question: i, skipped });
    await tick();
    document.getElementById(skipped ? `brief-unskip-${i}` : `brief-answer-${i}`)?.focus();
  }

  // Folding moves the cursor to Show the brief; showing it, to its heading.
  async function fold(next: boolean) {
    onfold(next);
    await tick();
    (next ? foldButton : heading)?.focus();
  }
</script>

<section class="brief" class:folded aria-labelledby="brief-heading">
  <header class="head">
    <h2 id="brief-heading" tabindex="-1" bind:this={heading}>Before I write</h2>
    {#if brief}<p class="meta">{meta}</p>{/if}
    {#if folded}
      <button type="button" class="button fold" bind:this={foldButton} onclick={() => fold(false)}>Show the brief</button>
    {:else if canFold && !running}
      <button type="button" class="button quiet fold" onclick={() => fold(true)}>Hide the brief</button>
    {/if}
  </header>

  {#if !folded}
    <div class="body">
      {#if !brief}
        <p class="intro">
          I'll make a short brief first: who to write to, what the ad needs most and which of your stories answer it, and any questions.
          You check it, then I write.
        </p>
      {:else}
        <div class="parts">
          <section class="part contact" aria-labelledby="brief-contact">
            <h3 id="brief-contact">Contact</h3>
            {#if !forLetter}<p class="for">For the cover letter.</p>{/if}
            <div class="contact-row">
              <label class="field name">
                <span>Name</span>
                <input
                  type="text"
                  value={brief.contact.name ?? ''}
                  maxlength={BRIEF_CAPS.name}
                  placeholder="No name in the ad"
                  oninput={(e) => onchange({ kind: 'name', name: e.currentTarget.value })}
                />
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  checked={brief.contact.recruiter}
                  onchange={(e) => onchange({ kind: 'recruiter', recruiter: e.currentTarget.checked })}
                />
                From a recruiter
              </label>
            </div>
            {#if brief.contact.email || brief.contact.organisation}
              <p class="muted small">{[brief.contact.email, brief.contact.organisation].filter(Boolean).join(' · ')}</p>
            {/if}
          </section>

          <section class="part opening" aria-labelledby="brief-opening">
            <h3 id="brief-opening">Opening line</h3>
            {#if !forLetter}<p class="for">For the cover letter.</p>{/if}
            <blockquote>{brief.opening.quote}</blockquote>
            {#if !brief.opening.inAd}
              <p class="warn"><span aria-hidden="true">⚠</span> This line isn't word for word in the ad. Check it.</p>
            {/if}
            <p class="why">{brief.opening.why}</p>
          </section>

          <section class="part needs" aria-labelledby="brief-needs">
            <h3 id="brief-needs">Needs</h3>
            {#if brief.needs.length === 0}
              <p class="muted">The AI found no clear needs in this ad. Press New brief to try again, or write without them.</p>
            {:else}
              <ul class="need-list">
                {#each brief.needs as need, i (i)}
                  <li class="need" class:dropped={need.dropped}>
                    <div class="need-head">
                      <p class="need-text" id="brief-need-{i}">{need.need}</p>
                      <button
                        type="button"
                        class="button small"
                        aria-describedby="brief-need-{i}"
                        onclick={() => onchange({ kind: 'drop', need: i, dropped: !need.dropped })}
                      >
                        {need.dropped ? 'Bring back' : 'Drop'}
                      </button>
                    </div>
                    {#if need.dropped}
                      <p class="muted small">Left out of the {forLetter ? 'letter' : 'resume'}.</p>
                    {:else}
                      <fieldset class="stories">
                        <legend class="visually-hidden">The story for “{need.need}”</legend>
                        {#each need.stories as s, j (j)}
                          <label class="story" class:chosen={need.chosen === j}>
                            <input
                              type="radio"
                              name="need-{i}"
                              checked={need.chosen === j}
                              onchange={() => onchange({ kind: 'story', need: i, chosen: j })}
                            />
                            <span class="story-text">
                              <span class="story-title">{s.title}</span>
                              {#if need.chosen === j}<span class="story-body">{s.text}</span>{/if}
                            </span>
                          </label>
                        {/each}
                      </fieldset>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>

          <section class="part gaps" aria-labelledby="brief-gaps">
            <h3 id="brief-gaps">Gaps</h3>
            {#if brief.gaps.length === 0}
              <p class="muted">None: your profile covers the ad's must-haves.</p>
            {:else}
              <ul class="gap-list">
                {#each brief.gaps as gap, i (i)}
                  <li><strong>{gap.mustHave}</strong> <span class="muted">{gap.evidence}</span></li>
                {/each}
              </ul>
            {/if}
          </section>

          <section class="part questions" aria-labelledby="brief-questions">
            <h3 id="brief-questions">Questions</h3>
            {#if brief.questions.length === 0}
              <p class="muted">No questions this time.</p>
            {:else}
              <ul class="question-list">
                {#each brief.questions as q, i (i)}
                  <li class="question" class:skipped={q.skipped}>
                    <label class="q" for="brief-answer-{i}" id="brief-question-{i}">{q.question}</label>
                    {#if q.fromEarlier}<p class="tag">Your answer from an earlier brief</p>{/if}
                    {#if q.skipped}
                      <div class="q-actions">
                        <span class="muted small">Skipped.</span>
                        <button
                          type="button"
                          class="button small"
                          id="brief-unskip-{i}"
                          aria-describedby="brief-question-{i}"
                          onclick={() => skip(i, false)}>Answer it</button
                        >
                      </div>
                    {:else}
                      <p class="why small" id="brief-why-{i}">{q.why}</p>
                      <textarea
                        id="brief-answer-{i}"
                        rows="2"
                        maxlength={BRIEF_CAPS.answer}
                        aria-describedby="brief-why-{i}"
                        value={q.answer ?? ''}
                        oninput={(e) => onchange({ kind: 'answer', question: i, answer: e.currentTarget.value })}
                      ></textarea>
                      <div class="q-actions">
                        <label class="check">
                          <input
                            type="checkbox"
                            checked={q.addToProfile}
                            aria-describedby="brief-question-{i}"
                            onchange={(e) => onchange({ kind: 'add', question: i, add: e.currentTarget.checked })}
                          />
                          Add to my profile
                        </label>
                        {#if q.addedAt && q.addToProfile}<span class="muted small">In your profile.</span>{/if}
                        <button
                          type="button"
                          class="button small"
                          aria-describedby="brief-question-{i}"
                          onclick={() => skip(i, true)}>Skip</button
                        >
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        </div>
      {/if}
    </div>
  {/if}

  {#if !folded || running}
    <footer class="actions" bind:this={footer}>
      <!-- Who's working, read out when it changes; the seconds aren't. It's
           always there (out of sight while idle), so the first words are read. -->
      <p class="progress" class:visually-hidden={!running}>
        <span aria-live="polite">{running ? progressText(running) : ''}</span>
        {#if running?.phase === 'working'}<span class="numeric timer" role="timer">{clock(now - running.since)}</span>{/if}
      </p>
      {#if making}
        <button type="button" class="button" onclick={oncancel}>Cancel</button>
        <button type="button" class="button" onclick={onskip}>Skip, just write</button>
      {:else if writing}
        <button type="button" class="button" onclick={onstop}>Stop</button>
      {:else}
        <button type="button" class="button primary write" onclick={onwrite}>{writeLabel(kind)}</button>
        <WriterLine />
        <span class="rest">
          <button type="button" class="button" onclick={onskip}>Skip, just write</button>
          {#if brief}<button type="button" class="button" onclick={onnew}>New brief</button>{/if}
        </span>
      {/if}
      {#if error}<p class="error message" role="alert">{error}</p>{/if}
      {#if notice}<p class="muted message" role="status">{notice}</p>{/if}
    </footer>
  {:else if error || notice}
    <div class="folded-message">
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if notice}<p class="muted" role="status">{notice}</p>{/if}
    </div>
  {/if}
</section>

<style>
  .brief {
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    min-width: 0;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    padding: var(--space-4) var(--space-5) 0;
  }

  .folded .head {
    align-items: center;
    padding-bottom: var(--space-4);
  }

  h2 {
    font-size: var(--step-2);
  }

  .folded h2 {
    font-size: var(--step-1);
  }

  h2:focus {
    outline: none;
  }

  h2:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  h3 {
    font-size: var(--step-0);
  }

  .meta {
    font-size: var(--step--1);
    color: var(--ink-2);
  }

  .fold {
    margin-left: auto;
  }

  .body {
    padding: var(--space-4) var(--space-5);
  }

  .intro {
    max-width: 60ch;
  }

  /* Contact | Opening line; the needs across; Gaps | Questions. */
  .parts {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
    grid-template-areas:
      'contact opening'
      'needs needs'
      'gaps questions';
    gap: var(--space-5) var(--space-6);
  }

  .contact {
    grid-area: contact;
  }

  .opening {
    grid-area: opening;
  }

  .needs {
    grid-area: needs;
  }

  .gaps {
    grid-area: gaps;
  }

  .questions {
    grid-area: questions;
  }

  .part {
    display: grid;
    gap: var(--space-2);
    align-content: start;
    min-width: 0;
  }

  .for {
    font-size: var(--step--1);
    color: var(--ink-2);
  }

  .small {
    font-size: var(--step--1);
  }

  .contact-row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-2) var(--space-4);
  }

  .contact-row .name {
    flex: 1 1 12rem;
    max-width: 18rem;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
  }

  .check input,
  .story input {
    accent-color: var(--accent);
    width: 1.05rem;
    height: 1.05rem;
    margin: 0;
    flex: none;
  }

  blockquote {
    margin: 0;
    padding-left: var(--space-3);
    border-left: 3px solid var(--accent);
    font-size: var(--step-1);
    line-height: 1.35;
  }

  .why {
    color: var(--ink-2);
  }

  .warn {
    color: var(--danger);
    font-weight: 700;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* The needs side by side, so you read them in one look. */
  .need-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
    gap: var(--space-4);
  }

  .need {
    display: grid;
    gap: var(--space-2);
    align-content: start;
    padding: var(--space-3);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
  }

  .need-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .need-text {
    font-weight: 700;
  }

  .need.dropped .need-text {
    color: var(--ink-2);
    text-decoration: line-through;
    font-weight: 400;
  }

  .button.small {
    padding: 0.125rem var(--space-3);
    font-size: var(--step--1);
    flex: none;
  }

  .stories {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  .story {
    display: flex;
    align-items: start;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-left: 3px solid transparent;
    border-radius: 0 var(--radius) var(--radius) 0;
    cursor: pointer;
  }

  .story:hover {
    background: var(--sheet-2);
  }

  .story input {
    margin-top: 0.2rem;
  }

  .story.chosen {
    background: var(--accent-soft);
    border-left-color: var(--accent);
  }

  .story-text {
    display: grid;
    gap: var(--space-1);
  }

  .story-title {
    font-weight: 600;
  }

  .story-body {
    font-size: var(--step--1);
  }

  .gap-list,
  .question-list {
    display: grid;
    gap: var(--space-3);
  }

  .gap-list li {
    display: grid;
  }

  .question {
    display: grid;
    gap: var(--space-1);
  }

  .q {
    font-weight: 700;
  }

  .question.skipped .q {
    color: var(--ink-2);
    font-weight: 400;
  }

  .tag {
    justify-self: start;
    font-size: var(--step--1);
    font-weight: 600;
    padding: 0 var(--space-2);
    border-radius: var(--radius);
    background: var(--sheet-2);
    color: var(--ink-2);
  }

  textarea {
    width: 100%;
    margin-top: var(--space-1);
  }

  .q-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
  }

  .q-actions .button {
    margin-left: auto;
  }

  /* The decision: one bold button, the writer beside it, the rest after.
     It stays at the foot of the window while the card is on screen. */
  .actions {
    position: sticky;
    bottom: 0;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-4);
    padding: var(--space-4) var(--space-5);
    border-top: 1px solid var(--rule);
    background: var(--sheet);
    border-radius: 0 0 var(--radius) var(--radius);
  }

  .folded .actions {
    position: static;
  }

  .write {
    font-size: var(--step-1);
    padding: var(--space-3) var(--space-5);
    box-shadow: 0 2px 0 color-mix(in srgb, var(--accent) 45%, var(--ink));
  }

  .rest {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-left: auto;
  }

  .progress {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-weight: 700;
    font-size: var(--step-1);
  }

  .timer {
    color: var(--ink-2);
    font-weight: 600;
  }

  .message {
    flex-basis: 100%;
  }

  .folded-message {
    padding: 0 var(--space-5) var(--space-4);
  }

  @media (max-width: 60rem) {
    .parts {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'contact' 'opening' 'needs' 'gaps' 'questions';
    }
  }
</style>
