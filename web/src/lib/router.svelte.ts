// A tiny router: three pages, real addresses (so reload and back work),
// and plain <a href> links that don't reload the page.

export type Route =
  | { name: 'home' }
  | { name: 'job'; id: number }
  | { name: 'settings' }
  | { name: 'not-found' };

function match(path: string): Route {
  if (path === '/' || path === '') return { name: 'home' };
  if (path === '/settings') return { name: 'settings' };
  const job = /^\/jobs\/(\d+)$/.exec(path);
  if (job) return { name: 'job', id: Number(job[1]) };
  return { name: 'not-found' };
}

export const router = $state({ route: match(location.pathname) as Route });

export function navigate(path: string): void {
  if (path !== location.pathname + location.search + location.hash) history.pushState({}, '', path);
  router.route = match(location.pathname);
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => {
  router.route = match(location.pathname);
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
