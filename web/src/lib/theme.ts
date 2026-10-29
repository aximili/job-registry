// Light, dark, or whatever this computer uses. The choice is kept in this
// browser (localStorage), like the board's "Show closed statuses".
// index.html applies it before the page first draws, so there's no flash.
// Keep THEME_KEY and the values in step with the script there.

export type Theme = 'system' | 'light' | 'dark';

export const THEME_KEY = 'jr-theme';

export function parseTheme(raw: string | null): Theme {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

// app.css reads data-theme on <html>. With none, it follows the computer.
export function applyTheme(root: Pick<Element, 'setAttribute' | 'removeAttribute'>, theme: Theme): void {
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function storedTheme(): Theme {
  return parseTheme(localStorage.getItem(THEME_KEY));
}

export function setTheme(theme: Theme): void {
  if (theme === 'system') localStorage.removeItem(THEME_KEY);
  else localStorage.setItem(THEME_KEY, theme);
  applyTheme(document.documentElement, theme);
}
