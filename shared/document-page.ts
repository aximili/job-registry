// The A4 page a resume or cover letter is shown on: the editor's preview,
// the print view and "Save as HTML" all use this one page, so what you see
// is what you print. The page can't run scripts or load anything.

import { escapeHtml, renderMarkdown } from './markdown.ts';

export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

export type DocumentPageInput = {
  title: string;
  markdown: string;
  // The template's CSS (or the copy frozen when it was sent).
  css: string;
  highlight?: string[];
  // Extra CSS for this view only, such as the preview's highlight colour.
  extraCss?: string;
};

// A stylesheet can't end its own <style> element: every "<" becomes the CSS
// escape \3c, which CSS reads as "<" inside a string and nowhere else needs.
const safeCss = (css: string): string => css.replace(/</g, '\\3c ');

export function documentPage(o: DocumentPageInput): string {
  const body = renderMarkdown(o.markdown, { highlight: o.highlight });
  return [
    '<!doctype html>',
    '<html lang="en-AU">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`,
    `<title>${escapeHtml(o.title)}</title>`,
    `<style>${safeCss(o.css)}${o.extraCss ? `\n${safeCss(o.extraCss)}` : ''}</style>`,
    '</head>',
    `<body><article class="document">${body}</article></body>`,
    '</html>',
  ].join('\n');
}
