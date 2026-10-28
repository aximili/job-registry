import { describe, expect, it } from 'vitest';
import { documentPage, PAGE_CSP } from './document-page.ts';

describe('documentPage', () => {
  it('is a full page with a strict content security policy', () => {
    const page = documentPage({ title: 'Sam – Resume', markdown: '# Sam', css: 'h1 { color: navy; }' });
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain(`<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`);
    expect(PAGE_CSP).toContain("default-src 'none'");
    expect(page).toContain('<article class="document"><h1>Sam</h1>');
    expect(page).toContain('h1 { color: navy; }');
  });

  it("doesn't let template CSS end the style element", () => {
    const page = documentPage({ title: 'x', markdown: 'Hi', css: 'body{} </style><script>alert(1)</script>' });
    expect(page.match(/<\/style/gi)).toHaveLength(1);
    expect(page).not.toMatch(/<script/i);
  });

  it('escapes the title', () => {
    expect(documentPage({ title: '<b>Sam</b>', markdown: '', css: '' })).toContain('<title>&lt;b&gt;Sam&lt;/b&gt;</title>');
  });

  it('passes highlights to the Markdown', () => {
    expect(documentPage({ title: 'x', markdown: 'Up 40%', css: '', highlight: ['40%'] })).toContain('<mark>40%</mark>');
  });
});
