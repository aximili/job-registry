// Settings the whole dashboard needs (the status list), loaded once and kept
// fresh when they change.

import { DEFAULT_SETTINGS, type Settings, type Status } from '../../../shared/contracts/index.ts';
import { api } from './api.ts';
import { onLive } from './live.svelte.ts';

export const app = $state({ settings: DEFAULT_SETTINGS as Settings, loaded: false });

export async function loadSettings(): Promise<void> {
  app.settings = await api.getSettings();
  app.loaded = true;
}

export function watchSettings(): () => void {
  // A failed reload keeps the settings it has; the next change loads them again.
  return onLive(['settings.changed'], () => void loadSettings().catch(() => undefined));
}

export function statuses(): Status[] {
  return [...app.settings.statuses].sort((a, b) => a.order - b.order);
}

export function findStatus(id: string): Status | undefined {
  return app.settings.statuses.find((s) => s.id === id);
}

export function statusLabel(id: string): string {
  return findStatus(id)?.label ?? id;
}
