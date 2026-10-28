import { describe, expect, it } from 'vitest';
import { lexMarkdown, renderMarkdown } from './markdown.ts';

describe('renderMarkdown', () => {
  it('shows raw HTML as text, so nothing in it runs or loads', () => {
    const html = renderMarkdown(
      'Hi <script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src=//evil></iframe>\n\nA <b>bold</b> claim.',
    );
    expect(html).not.toMatch(/<script|<img|<iframe|<b>/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('keeps http, https and mailto links, and turns any other link into plain text', () => {
    const html = renderMarkdown('[x](javascript:alert(1)) [d](data:text/html,hi) [me](https://example.com) [mail](mailto:a@b.co)');
    expect(html).not.toMatch(/javascript:|data:text/);
    expect(html).toContain('<a href="https://example.com">me</a>');
    expect(html).toContain('<a href="mailto:a@b.co">mail</a>');
    expect(html).toMatch(/>x<|\bx\b/);
  });

  it('shows an image as its alt text', () => {
    const html = renderMarkdown('![logo](http://evil/x.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('logo');
  });

  it('renders headings, lists and emphasis, with line breaks kept', () => {
    const html = renderMarkdown('# Sam Taylor\nsam@example.com\n\n- **Led** a team\n- Wrote _tests_');
    expect(html).toContain('<h1>Sam Taylor</h1>');
    expect(html).toContain('<li><strong>Led</strong> a team</li>');
    expect(html).toContain('<em>tests</em>');
  });

  it('highlights text with <mark>, in text only and never inside a tag', () => {
    expect(renderMarkdown('Grew sales by 40%.', { highlight: ['40%'] })).toContain('Grew sales by <mark>40%</mark>.');
    const html = renderMarkdown('A p and a P.', { highlight: ['p'] });
    expect(html.startsWith('<p>')).toBe(true);
    expect(html).toContain('A <mark>p</mark> and a <mark>P</mark>.');
  });

  it('highlights text that needs escaping, such as R&D', () => {
    expect(renderMarkdown('Ran R&D at Globex.', { highlight: ['R&D'] })).toContain('<mark>R&amp;D</mark>');
  });

  it('lexMarkdown gives the same tokens the renderer uses', () => {
    const tokens = lexMarkdown('# Name\n\n- one');
    expect(tokens.map((t) => t.type)).toEqual(['heading', 'space', 'list']);
  });
});

describe('renderMarkdown: highlights only whole words and numbers', () => {
  it('never marks part of a longer number or word', () => {
    expect(renderMarkdown('A team of 5 since 2015, with $150,000.', { highlight: ['5'] })).toContain(
      'A team of <mark>5</mark> since 2015, with $150,000.',
    );
    expect(renderMarkdown('apples and p', { highlight: ['p'] })).toContain('apples and <mark>p</mark>');
    expect(renderMarkdown('Up $200k.', { highlight: ['$200k'] })).toContain('Up <mark>$200k</mark>.');
  });
});
