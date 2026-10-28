<script lang="ts">
  // The live A4 preview: the same page the print view serves, in a sandboxed
  // frame, so nothing in the document can run or load. Fact-check flags are
  // highlighted here only, never in print.
  import { documentPage } from '../../../shared/document-page.ts';

  let { title, markdown, css, highlight }: { title: string; markdown: string; css: string; highlight: string[] } = $props();

  const PREVIEW_CSS = 'mark { background: #ffe27a; color: inherit; padding: 0 1px; border-radius: 2px; }';

  let html = $state('');
  let latest = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Redrawn at most every 300 ms, so typing stays smooth and a draft being
  // written shows as it comes.
  $effect(() => {
    latest = documentPage({ title, markdown, css, highlight, extraCss: PREVIEW_CSS });
    if (!html) html = latest;
    else
      timer ??= setTimeout(() => {
        timer = undefined;
        html = latest;
      }, 300);
  });

  // Only when the preview goes away.
  $effect(() => () => clearTimeout(timer));
</script>

<iframe title="Preview" sandbox="" srcdoc={html}></iframe>

<style>
  iframe {
    width: 100%;
    height: 100%;
    min-height: 70vh;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: #e6e7ec;
  }
</style>
