// A page element's text, laid out the way you'd read it: paragraphs on their
// own lines and list items as bullets. The same rules as the server's.

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'BUTTON', 'IFRAME']);
const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TR', 'HEADER', 'FOOTER', 'BLOCKQUOTE', 'PRE']);

function walk(node: Node): string {
  if (node.nodeType === 3) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (SKIP.has(tag)) return '';
  if (tag === 'BR') return '\n';
  const inner = Array.from(el.childNodes, walk).join('');
  if (tag === 'LI') return `\n• ${inner.trim()}\n`;
  if (tag === 'TD' || tag === 'TH') return `${inner.trim()}\t`;
  if (BLOCK.has(tag)) return `\n\n${inner.trim()}\n\n`;
  return inner;
}

export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, '').replace(/^[ \t]+/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function elementText(el: Element | null | undefined): string {
  return el ? tidyText(walk(el)) : '';
}

// HTML from a page's data (such as a JobPosting description) to text. It's
// parsed in a separate, inert document, so nothing in it can run or load.
export function htmlToText(html: string, doc: Document): string {
  const Parser = (doc.defaultView as (Window & typeof globalThis) | null)?.DOMParser ?? globalThis.DOMParser;
  if (!Parser) return tidyText(html.replace(/<[^>]+>/g, ' '));
  const inert = new Parser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  return elementText(inert.body);
}
