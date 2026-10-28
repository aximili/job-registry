// Turning web pages and pasted text into clean, readable ad text.

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGURE', 'FOOTER', 'FORM',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
  'TABLE', 'TR', 'UL',
]);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);

// Tidies pasted or extracted text without losing any words:
// Windows line breaks, non-breaking spaces, trailing spaces and long runs of blank lines.
export function normaliseText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00A0\u202F]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// HTML (such as a JobPosting description) to plain text with paragraphs and bullets.
export function htmlFragmentToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return normaliseText(nodeText(document.body as unknown as HtmlNode));
}

// The main readable text of a whole page, using Mozilla's Readability.
export function readableText(html: string): { title: string | null; text: string } {
  const { document } = parseHTML(html);
  const pageTitle = document.title?.trim() || null;
  try {
    const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0]).parse();
    if (article?.content) {
      return { title: article.title?.trim() || pageTitle, text: htmlFragmentToText(article.content) };
    }
  } catch {
    // Fall back to the whole body below.
  }
  return { title: pageTitle, text: htmlFragmentToText(document.body?.innerHTML ?? '') };
}

// The little of a parsed HTML node this needs. The server has no browser DOM
// types on purpose, so a browser-only global can't slip into server code.
type HtmlNode = { nodeType: number; textContent: string | null; tagName?: string; childNodes: ArrayLike<HtmlNode> };

function nodeText(node: HtmlNode): string {
  if (node.nodeType === 3) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  const el = node;
  const tag = (el.tagName ?? '').toUpperCase();
  if (SKIP_TAGS.has(tag)) return '';
  if (tag === 'BR') return '\n';
  const inner = Array.from(el.childNodes, nodeText).join('');
  if (tag === 'LI') return `\n• ${inner.trim()}\n`;
  if (tag === 'TD' || tag === 'TH') return `${inner.trim()}\t`;
  if (BLOCK_TAGS.has(tag)) return `\n\n${inner.trim()}\n\n`;
  return inner;
}
