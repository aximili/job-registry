// The search box is in the header on every page. Its state lives here so the
// home page can show the results, and any page can jump back to it.

import type { SearchHit } from '../../../shared/contracts/index.ts';
import { api } from './api.ts';
import { friendlyError } from './errors.ts';

export const search = $state({
  query: '',
  hits: [] as SearchHit[],
  active: 0,
  searched: '',
  error: null as string | null,
});

const DEBOUNCE_MS = 80;
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | null = null;

export function setQuery(q: string): void {
  search.query = q;
  clearTimeout(timer);
  if (!q.trim()) {
    controller?.abort();
    search.hits = [];
    search.searched = '';
    search.active = 0;
    return;
  }
  timer = setTimeout(() => void run(q), DEBOUNCE_MS);
}

async function run(q: string): Promise<void> {
  controller?.abort();
  controller = new AbortController();
  try {
    const res = await api.search(q, { signal: controller.signal });
    if (q !== search.query) return;
    search.hits = res.hits;
    search.searched = q;
    search.active = 0;
    search.error = null;
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    search.error = friendlyError(err);
  }
}

// Search straight away for what is typed now. Enter uses this, so it can never
// open a result left over from the previous search.
export async function searchNow(): Promise<void> {
  clearTimeout(timer);
  if (!search.query.trim() || search.searched === search.query) return;
  await run(search.query);
}

export function clearSearch(): void {
  setQuery('');
}

export function moveActive(step: number): void {
  if (search.hits.length === 0) return;
  search.active = (search.active + step + search.hits.length) % search.hits.length;
}

export function focusSearch(): void {
  const box = document.getElementById('search-box') as HTMLInputElement | null;
  box?.focus();
  box?.select();
}
