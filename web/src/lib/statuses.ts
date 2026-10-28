// Helpers for editing the status list on the Settings page.

import { RESERVED_STATUS_IDS, type Status } from '../../../shared/contracts/index.ts';

// "Phone screen" → "phone_screen". Never clashes with an existing or reserved id.
export function slugifyStatusId(label: string, existing: string[]): string {
  const base =
    label
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'status';
  let id = base;
  for (let n = 2; existing.includes(id) || RESERVED_STATUS_IDS.includes(id); n++) id = `${base}_${n}`;
  return id;
}

// Moves a status up (-1) or down (1), and renumbers order as 10, 20, 30, …
export function moveStatus(list: Status[], id: string, dir: -1 | 1): Status[] {
  const sorted = [...list].sort((a, b) => a.order - b.order);
  const from = sorted.findIndex((s) => s.id === id);
  const to = from + dir;
  if (from >= 0 && to >= 0 && to < sorted.length) [sorted[from], sorted[to]] = [sorted[to]!, sorted[from]!];
  return sorted.map((s, i) => ({ ...s, order: (i + 1) * 10 }));
}
