// The messages between the content script, the popup and the background
// script. Only the background talks to the server; everyone else asks it.

import type { Capture, Health, JobCheckResponse, RateResponse, SaveDecision, SaveJobResponse } from '../../shared/contracts/index.ts';

export type Request =
  | { type: 'check'; capture: Capture }
  | { type: 'rate'; capture: Capture }
  | { type: 'save'; capture: Capture; status: string; note: string; decision?: SaveDecision }
  | { type: 'captureActiveTab' }
  | { type: 'openJob'; jobId: number }
  | { type: 'health' };

export type ReplyData = {
  check: JobCheckResponse;
  rate: RateResponse;
  save: SaveJobResponse;
  captureActiveTab: Capture | null;
  openJob: null;
  health: Health;
};

// offline: the app couldn't be reached at all. error "cancelled": a newer
// request replaced this one, so nothing should be shown for it.
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string; offline: boolean };

export type ReplyFor<R extends Request> = Reply<ReplyData[R['type']]>;

export const OFFLINE = "Job Registry isn't running. Start it, then press Try again.";

// From a content script or the popup.
export async function ask<R extends Request>(req: R): Promise<ReplyFor<R>> {
  try {
    return (await chrome.runtime.sendMessage(req)) as ReplyFor<R>;
  } catch {
    // The extension itself was just updated or reloaded.
    return { ok: false, error: 'Reload this page to use Job Registry here.', offline: false };
  }
}
