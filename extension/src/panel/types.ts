// What the panel shows, and what it can ask the content script to do.

import type { Candidate, Rating } from '../../../shared/contracts/index.ts';
import type { PanelPlace } from './place.ts';

export type PanelState =
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'unreadable'; error: string | null }
  | { kind: 'new'; saving: boolean; error: string | null }
  | { kind: 'likely'; candidates: Candidate[]; saving: boolean; error: string | null }
  | { kind: 'saved'; jobId: number; status: string; dateApplied: string | null }
  | { kind: 'error'; message: string };

export type RatingState =
  | { kind: 'off' }
  | { kind: 'pending' }
  | { kind: 'done'; rating: Rating }
  | { kind: 'none'; reason: string }
  | { kind: 'error'; message: string };

// job: the job on screen, so you can see what a rating or "Saved" is about.
// jobKey: which job it is; the status and note you chose reset only when it changes.
// place: where you moved the panel, and the size you gave it.
export type PanelView = {
  state: PanelState;
  rating: RatingState;
  minimised: boolean;
  place: PanelPlace;
  job: { title: string | null; company: string | null } | null;
  jobKey: string | null;
};

export type PanelActions = {
  save(status: string, note: string): void;
  same(jobId: number, status: string, note: string): void;
  different(status: string, note: string): void;
  retry(): void;
  open(jobId: number): void;
  saveSelection(): void;
  savePage(): void;
  setMinimised(minimised: boolean): void;
  setPlace(place: PanelPlace): void;
};
