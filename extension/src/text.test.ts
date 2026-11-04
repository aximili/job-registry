import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { MAILTO_CASES } from '../../tests/fixtures/mailto-cases.ts';
import { elementText } from './text.ts';

function body(html: string): Element {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return document.body as unknown as Element;
}

describe('text', () => {
  it('turns paragraphs, line breaks and bullets into plain text', () => {
    expect(elementText(body('<p>Hello</p><p>Line one<br>Line two</p><ul><li>One</li><li>Two</li></ul>'))).toBe(
      'Hello\n\nLine one\nLine two\n\n• One\n\n• Two',
    );
  });

  describe("keeps a mailto: address that the link's text hides", () => {
    for (const { html, text } of MAILTO_CASES) {
      it(html, () => {
        expect(elementText(body(html))).toBe(text);
      });
    }
  });
});
