// The content script on Seek, LinkedIn and Indeed. It watches for the job on
// screen, asks the background script whether it's saved (never the server
// itself), shows the panel, and rates the job if you've left that on.

import type { Capture, SaveDecision } from '../../shared/contracts/index.ts';
import { fallbackCapture } from './capture.ts';
import { ask } from './messages.ts';
import { mountPanel, type PanelView } from './panel/mount.ts';
import { loadSettings } from './settings.ts';
import { pickExtractor } from './sites/index.ts';
import { watchJobs } from './watcher.ts';

// The browser tests serve copies of the sites at one local address
// (/seek/…, /linkedin/…, /indeed/…). This turns those back into the real
// addresses. It's empty in the real extension.
declare const __E2E_SITES__: string | undefined;
const TEST_HOSTS: Record<string, string> = { seek: 'www.seek.com.au', linkedin: 'www.linkedin.com', indeed: 'au.indeed.com' };

function siteLocation(): URL {
  const url = new URL(location.href);
  if (typeof __E2E_SITES__ === 'string' && url.origin === __E2E_SITES__) {
    const [, site = '', ...rest] = url.pathname.split('/');
    const host = TEST_HOSTS[site];
    if (host) return new URL(`https://${host}/${rest.join('/')}${url.search}`);
  }
  return url;
}

let panel: ReturnType<typeof mountPanel> | null = null;
let view: PanelView = { state: { kind: 'loading' }, rating: { kind: 'off' }, minimised: false, job: null, jobKey: null };
let capture: Capture | null = null;
let jobId: string | null = null;
// Each job on screen gets a number; replies for an older one are dropped.
let seq = 0;

function show(next: Partial<PanelView>): void {
  view = { ...view, ...next };
  panel?.show(view);
}

// The status and note always come from the panel's form for this job, so
// one job's choice can never carry over to another.
const actions = {
  save: (status: string, note: string) => void save(status, note),
  same: (linkTo: number, status: string, note: string) => void save(status, note, { linkTo }),
  different: (status: string, note: string) => void save(status, note, 'new'),
  retry: () => void check(seq),
  open: (jobId: number) => void ask({ type: 'openJob', jobId }),
  saveSelection: () => fallback('selection'),
  savePage: () => fallback('page'),
  setMinimised: (minimised: boolean) => {
    show({ minimised });
    void chrome.storage.local.set({ panelMinimised: minimised });
  },
};

async function check(mine: number): Promise<void> {
  if (!capture) return;
  show({ state: { kind: 'loading' } });
  const res = await ask({ type: 'check', capture });
  if (mine !== seq) return;
  if (!res.ok) {
    show({ state: res.offline ? { kind: 'offline' } : { kind: 'error', message: res.error } });
    return;
  }
  const { exact, candidates } = res.data;
  if (exact) show({ state: { kind: 'saved', jobId: exact.jobId, status: exact.status, dateApplied: exact.dateApplied } });
  else if (candidates.length > 0) show({ state: { kind: 'likely', candidates, saving: false, error: null } });
  else show({ state: { kind: 'new', saving: false, error: null } });
  await rate(mine);
}

async function rate(mine: number): Promise<void> {
  const autoRate = capture ? (await loadSettings()).autoRate : false;
  if (mine !== seq) return;
  if (!capture || !autoRate) {
    show({ rating: { kind: 'off' } });
    return;
  }
  show({ rating: { kind: 'pending' } });
  const res = await ask({ type: 'rate', capture });
  if (mine !== seq) return;
  if (!res.ok) {
    if (res.error === 'cancelled') return;
    show({ rating: res.offline ? { kind: 'off' } : { kind: 'error', message: res.error } });
    return;
  }
  show({ rating: res.data.rating ? { kind: 'done', rating: res.data.rating } : { kind: 'none', reason: res.data.reason ?? 'No rating.' } });
}

async function save(status: string, note: string, decision?: SaveDecision): Promise<void> {
  if (!capture) return;
  const mine = seq;
  const s = view.state;
  if (s.kind === 'new' || s.kind === 'likely') show({ state: { ...s, saving: true, error: null } });
  const res = await ask({ type: 'save', capture, status, note, ...(decision ? { decision } : {}) });
  if (mine !== seq) return;
  if (!res.ok) {
    if (res.offline) show({ state: { kind: 'offline' } });
    else if (s.kind === 'new' || s.kind === 'likely') show({ state: { ...s, saving: false, error: res.error } });
    else show({ state: { kind: 'error', message: res.error } });
    return;
  }
  if (res.data.result === 'needs_decision') {
    show({ state: { kind: 'likely', candidates: res.data.candidates, saving: false, error: null } });
    return;
  }
  const job = res.data.job;
  show({ state: { kind: 'saved', jobId: job.id, status: job.status, dateApplied: job.dateApplied } });
}

function fallback(from: 'selection' | 'page'): void {
  const found = fallbackCapture(document, siteLocation(), new Date(), from);
  if (!found) {
    // Stay on the same choice, so you can select the text and press it again.
    const error = from === 'selection' ? 'Select the ad text first, then press Save selection.' : 'This page has no text to save.';
    show({ state: { kind: 'unreadable', error } });
    return;
  }
  capture = found;
  show({ job: { title: found.title ?? null, company: found.company ?? null } });
  void check(seq);
}

async function onJob(found: Capture | null, id: string | null): Promise<void> {
  // More of the same job's ad arrived: use the fuller text, and rate it
  // again, but leave the panel (and what you've chosen in it) as it is.
  if (found && capture && id === jobId) {
    capture = found;
    show({ job: { title: found.title ?? null, company: found.company ?? null } });
    if (view.rating.kind !== 'off') void rate(seq);
    return;
  }
  const mine = ++seq;
  capture = found;
  jobId = id;
  if (!panel) {
    const stored = (await chrome.storage.local.get('panelMinimised')) as { panelMinimised?: boolean };
    view = { ...view, minimised: stored.panelMinimised === true };
    panel = mountPanel(document, actions, view);
  }
  if (mine !== seq) return;
  if (!found) {
    show({ state: { kind: 'unreadable', error: null }, rating: { kind: 'off' }, job: null, jobKey: id });
    return;
  }
  show({ rating: { kind: 'off' }, job: { title: found.title ?? null, company: found.company ?? null }, jobKey: id });
  await check(mine);
}

watchJobs({
  doc: document,
  location: siteLocation,
  extractor: () => pickExtractor(siteLocation()),
  onJob: (found, id) => void onJob(found, id),
  onLeave: () => {
    seq++;
    capture = null;
    jobId = null;
    panel?.destroy();
    panel = null;
  },
  now: () => new Date(),
});
