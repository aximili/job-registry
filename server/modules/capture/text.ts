// Turning web pages and pasted text into clean, readable ad text.

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { htmlFragmentToText } from '../../core/html-text.ts';

export { htmlFragmentToText, normaliseText } from '../../core/html-text.ts';

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
