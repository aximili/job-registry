import { describe, expect, it } from 'vitest';
import { applyTheme, parseTheme } from './theme.ts';

describe('parseTheme', () => {
  it('reads a stored light or dark', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
  });

  it('matches the computer when nothing, or something else, is stored', () => {
    expect(parseTheme(null)).toBe('system');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme('blue')).toBe('system');
  });
});

describe('applyTheme', () => {
  it('sets data-theme for light or dark, and removes it to match the computer', () => {
    const attrs = new Map<string, string>();
    const root = {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    };
    applyTheme(root, 'dark');
    expect(attrs.get('data-theme')).toBe('dark');
    applyTheme(root, 'light');
    expect(attrs.get('data-theme')).toBe('light');
    applyTheme(root, 'system');
    expect(attrs.has('data-theme')).toBe(false);
  });
});
