// Watches a job site for the job on screen. Seek, LinkedIn and Indeed change
// jobs without reloading the page, so this checks the address (and the job id
// in it) every half second. When the job changes, it waits for that job's
// details to appear, then reports it, and again if more of it arrives within
// 5 seconds. If nothing appears in that time, it reports the job with nothing
// read, so the panel can say so.

import type { Capture } from '../../shared/contracts/index.ts';
import type { SiteExtractor } from './sites/index.ts';

export type WatchOptions = {
  doc: Document;
  location: () => URL;
  extractor: () => SiteExtractor;
  onJob: (capture: Capture | null, jobId: string | null) => void;
  // You moved from a job to a page with no job on it.
  onLeave?: () => void;
  now: () => Date;
  intervalMs?: number;
  waitMs?: number;
};

const NONE = Symbol('no job yet');

export function watchJobs(opts: WatchOptions): () => void {
  const intervalMs = opts.intervalMs ?? 500;
  const waitMs = opts.waitMs ?? 5000;
  let current: string | null | typeof NONE = NONE;
  // What was last reported for this job, and the last job shown before it
  // (its id too: coming back to that same job is not "still loading").
  let reported: string | null = null;
  let previous: { id: string; sig: string } | null = null;
  let reportedId: string | null = null;
  let gaveUp = false;
  let since = 0;
  let soon: ReturnType<typeof setTimeout> | undefined;

  const signature = (c: Capture) => `${c.title ?? ''}\n${c.jdText}`;

  function read(site: SiteExtractor, url: URL): Capture | null {
    try {
      return site.extract(opts.doc, url, opts.now());
    } catch {
      // A reader that trips over an odd page has simply read nothing yet.
      return null;
    }
  }

  function tick(): void {
    const url = opts.location();
    const site = opts.extractor();
    const id = site.currentJobId(url, opts.doc);
    if (id !== current) {
      // A new job (or none): start waiting for its details. An older job
      // that never finished loading is simply forgotten.
      if (id === null && current !== NONE && current !== null) opts.onLeave?.();
      if (reported !== null && reportedId !== null) previous = { id: reportedId, sig: reported };
      current = id;
      reported = null;
      gaveUp = false;
      since = Date.now();
    }
    if (id === null) return;
    const waiting = Date.now() - since < waitMs;
    // Once reported, keep looking for a few seconds: more of the ad may arrive.
    if (reported !== null && !waiting) return;
    let capture = read(site, url);
    // A split pane often still shows the last job for a moment after the
    // address changes. Another job's details mean "not loaded yet".
    if (capture && previous && previous.id !== id && signature(capture) === previous.sig) capture = null;
    if (capture) {
      const sig = signature(capture);
      if (sig !== reported) {
        reported = sig;
        reportedId = id;
        gaveUp = false;
        opts.onJob(capture, id);
      }
    } else if (reported === null && !waiting && !gaveUp) {
      // Nothing yet: say so, but keep looking quietly. A slow page that fills
      // in later still gets read.
      gaveUp = true;
      opts.onJob(null, id);
    }
  }

  tick();
  const timer = setInterval(tick, intervalMs);

  // Page changes can mean the details just arrived: look again shortly,
  // without running on every one of a busy page's many changes.
  const Observer = (opts.doc.defaultView as (Window & typeof globalThis) | null)?.MutationObserver ?? globalThis.MutationObserver;
  const observer = Observer
    ? new Observer(() => {
        if (soon) return;
        soon = setTimeout(() => {
          soon = undefined;
          tick();
        }, 100);
      })
    : null;
  if (observer && opts.doc.body) observer.observe(opts.doc.body, { childList: true, subtree: true, characterData: true });

  return () => {
    clearInterval(timer);
    clearTimeout(soon);
    observer?.disconnect();
  };
}
