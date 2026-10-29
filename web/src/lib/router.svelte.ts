// A tiny router: a handful of pages, real addresses (so reload and back work),
// and plain <a href> links that don't reload the page.

import type { DocumentKind } from '../../../shared/contracts/index.ts';

export type Route =
  | { name: 'home' }
  | { name: 'job'; id: number }
  // docId is null for a new document; kind comes from ?kind= then.
  | { name: 'document'; jobId: number; docId: number | null; kind: DocumentKind | null }
  | { name: 'settings' }
  | { name: 'inbox' }
  | { name: 'board' }
  | { name: 'not-found' };

function match(path: string, search = ''): Route {
  if (path === '/' || path === '') return { name: 'home' };
  if (path === '/settings') return { name: 'settings' };
  if (path === '/inbox') return { name: 'inbox' };
  if (path === '/board') return { name: 'board' };
  const job = /^\/jobs\/(\d+)$/.exec(path);
  if (job) return { name: 'job', id: Number(job[1]) };
  const doc = /^\/jobs\/(\d+)\/documents\/(new|\d+)$/.exec(path);
  if (doc) {
    const kind = new URLSearchParams(search).get('kind');
    return {
      name: 'document',
      jobId: Number(doc[1]),
      docId: doc[2] === 'new' ? null : Number(doc[2]),
      kind: kind === 'resume' || kind === 'cover_letter' ? kind : null,
    };
  }
  return { name: 'not-found' };
}

export const router = $state({ route: match(location.pathname, location.search) as Route });

// A page with unsaved text can ask before you leave it: the guard returns
// the question to ask, or null when there's nothing to lose.
let leaveGuard: (() => string | null) | null = null;

export function setLeaveGuard(guard: (() => string | null) | null): void {
  leaveGuard = guard;
}

export function navigate(path: string): void {
  const question = leaveGuard?.();
  if (question && !confirm(question)) return;
  if (path !== location.pathname + location.search + location.hash) history.pushState({}, '', path);
  router.route = match(location.pathname, location.search);
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => {
  router.route = match(location.pathname, location.search);
});

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element | null)?.closest('a');
  if (!link || link.target || link.hasAttribute('download')) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin) return;
  event.preventDefault();
  navigate(url.pathname + url.search + url.hash);
});
