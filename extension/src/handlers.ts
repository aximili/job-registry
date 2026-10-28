// What the background script does for each message. Kept apart from
// background.ts so it can be tested without a browser.

import { ApiError, type ApiClient } from '../../shared/api-client.ts';
import type { Capture } from '../../shared/contracts/index.ts';
import { OFFLINE, type Reply, type ReplyFor, type Request } from './messages.ts';

// The few browser calls this needs.
export interface ChromeLike {
  setBadge(tabId: number, text: string): Promise<void>;
  currentTabId(): Promise<number | null>;
  // Runs the files in the tab, then returns what the reader found there.
  runScript(tabId: number, files: string[]): Promise<unknown>;
  openTab(url: string): Promise<void>;
  // Whether the extension may still reach this computer (you can take that away).
  hasHostAccess(): Promise<boolean>;
}

export type Sender = { tabId: number | null };

const SAVED = '✓';

export const NO_ACCESS = "The extension isn't allowed to reach Job Registry on this computer. Open its options and press Allow access.";

async function failure(err: unknown, chrome: ChromeLike): Promise<Reply<never>> {
  if ((err as Error)?.name === 'TimeoutError') return { ok: false, error: NOT_ANSWERING, offline: false };
  if ((err as Error)?.name === 'AbortError') return { ok: false, error: 'cancelled', offline: false };
  if (err instanceof ApiError) return { ok: false, error: err.message, offline: false };
  // fetch throws a TypeError when nothing answers at that address, and also
  // when the browser won't let the extension reach it at all.
  if (err instanceof TypeError) {
    if (!(await chrome.hasHostAccess().catch(() => true))) return { ok: false, error: NO_ACCESS, offline: false };
    return { ok: false, error: OFFLINE, offline: true };
  }
  return { ok: false, error: (err as Error)?.message || 'Something went wrong.', offline: false };
}

export const NOT_ANSWERING = "Job Registry isn't answering. Try again in a moment.";

// Ratings can take a while (the AI may be starting); everything else is quick.
const QUICK_MS = 15_000;

export function createHandlers(deps: {
  api: () => ApiClient | Promise<ApiClient>;
  chrome: ChromeLike;
  serverUrl: () => Promise<string>;
  timeoutMs?: number;
}) {
  const quick = () => AbortSignal.timeout(deps.timeoutMs ?? QUICK_MS);
  // One rating at a time per tab: a newer one cancels the older one.
  const ratings = new Map<number, AbortController>();

  async function run(req: Request, sender: Sender): Promise<unknown> {
    const api = await deps.api();
    switch (req.type) {
      case 'check': {
        const res = await api.checkJob(
          {
            canonicalUrl: req.capture.canonicalUrl,
            sourceSite: req.capture.sourceSite,
            externalId: req.capture.externalId,
            ...(req.capture.title ? { title: req.capture.title } : {}),
            ...(req.capture.company ? { company: req.capture.company } : {}),
            ...(req.capture.location ? { location: req.capture.location } : {}),
          },
          { signal: quick() },
        );
        if (sender.tabId !== null) await deps.chrome.setBadge(sender.tabId, res.exact ? SAVED : '');
        return res;
      }
      case 'rate': {
        const tab = sender.tabId ?? -1;
        ratings.get(tab)?.abort();
        const controller = new AbortController();
        ratings.set(tab, controller);
        try {
          return await api.rate({ capture: req.capture, key: `tab-${tab}` }, { signal: controller.signal });
        } finally {
          if (ratings.get(tab) === controller) ratings.delete(tab);
        }
      }
      case 'save': {
        const res = await api.saveJob(
          {
            capture: req.capture,
            status: req.status,
            source: 'extension',
            ...(req.decision ? { decision: req.decision } : {}),
          },
          { signal: quick() },
        );
        if (res.result !== 'needs_decision') {
          if (req.note.trim()) await api.addNote(res.job.id, req.note.trim());
          if (sender.tabId !== null) await deps.chrome.setBadge(sender.tabId, SAVED);
        }
        return res;
      }
      case 'captureActiveTab': {
        const tabId = await deps.chrome.currentTabId();
        if (tabId === null) return null;
        return ((await deps.chrome.runScript(tabId, ['generic.js'])) as Capture | null) ?? null;
      }
      case 'openJob': {
        await deps.chrome.openTab(`${await deps.serverUrl()}/jobs/${req.jobId}`);
        return null;
      }
      case 'health':
        return api.health({ signal: quick() });
    }
  }

  return async function handle<R extends Request>(req: R, sender: Sender): Promise<ReplyFor<R>> {
    try {
      return { ok: true, data: (await run(req, sender)) as ReplyFor<R> extends Reply<infer T> ? T : never } as ReplyFor<R>;
    } catch (err) {
      return (await failure(err, deps.chrome)) as ReplyFor<R>;
    }
  };
}
