// Markdown for resumes and cover letters, rendered the same way everywhere:
// the editor's preview, the print view and the .docx export. Anything in it
// that could run or load (raw HTML, script links, images) shows as plain text.

import { Marked, type Token, type Tokens } from 'marked';

const SAFE_LINK = /^(https?:|mailto:)/i;

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c]!);
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Set only while one (synchronous) render runs.
let highlighter: RegExp | null = null;

function highlightText(text: string): string {
  if (!highlighter) return escapeHtml(text);
  let html = '';
  let at = 0;
  for (const match of text.matchAll(highlighter)) {
    html += escapeHtml(text.slice(at, match.index)) + `<mark>${escapeHtml(match[0])}</mark>`;
    at = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(at));
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag): string {
      const text = escapeHtml(token.text);
      return 'block' in token && token.block ? `<p>${text.trim()}</p>\n` : text;
    },
    link(token: Tokens.Link): string {
      const text = this.parser.parseInline(token.tokens);
      if (!SAFE_LINK.test(token.href.trim())) return text;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<a href="${escapeHtml(token.href.trim())}"${title}>${text}</a>`;
    },
    image(token: Tokens.Image): string {
      return escapeHtml(token.text);
    },
    text(token: Tokens.Text | Tokens.Escape): string {
      if ('tokens' in token && token.tokens) return this.parser.parseInline(token.tokens);
      // An escape token's text is a single character, still raw.
      return highlightText(token.text);
    },
  },
});

export type RenderOptions = {
  // Text to wrap in <mark> wherever it appears, ignoring case (the fact-check's flags).
  highlight?: string[];
};

export function renderMarkdown(md: string, opts: RenderOptions = {}): string {
  const words = (opts.highlight ?? []).filter((w) => w.trim()).sort((a, b) => b.length - a.length);
  // Whole words and numbers only: a flag of 5 never lights up 2015 or $150,000.
  highlighter =
    words.length > 0
      ? new RegExp(`(?<![\\p{L}\\p{N}]|\\p{N}[.,])(?:${words.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}]|[.,]\\p{N})`, 'giu')
      : null;
  try {
    return marked.parse(md, { async: false });
  } finally {
    highlighter = null;
  }
}

// The same tokens the renderer works from, for the .docx export.
export function lexMarkdown(md: string): Token[] {
  return marked.lexer(md);
}

export type { Token, Tokens };
