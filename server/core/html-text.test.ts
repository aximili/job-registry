import { describe, expect, it } from 'vitest';
import { MAILTO_CASES } from '../../tests/fixtures/mailto-cases.ts';
import { htmlFragmentToText, normaliseText } from './html-text.ts';

describe('html-text', () => {
  it('turns paragraphs, line breaks and bullets into plain text', () => {
    expect(htmlFragmentToText('<p>Hello</p><p>Line one<br>Line two</p><ul><li>One</li><li>Two</li></ul>')).toBe(
      'Hello\n\nLine one\nLine two\n\n• One\n\n• Two',
    );
  });

  it('drops styles and scripts, and decodes entities', () => {
    expect(htmlFragmentToText('<style>p{color:red}</style><p>We&#39;d like &amp; hope</p><script>alert(1)</script>')).toBe(
      "We'd like & hope",
    );
  });

  it('tidies Windows line breaks, trailing spaces and long gaps', () => {
    expect(normaliseText('a  \r\n\r\n\r\n\r\nb')).toBe('a\n\nb');
  });

  describe("keeps a mailto: address that the link's text hides", () => {
    for (const { html, text } of MAILTO_CASES) {
      it(html, () => {
        expect(htmlFragmentToText(html)).toBe(text);
      });
    }
  });
});
