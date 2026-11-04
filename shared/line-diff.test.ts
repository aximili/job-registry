import { describe, expect, it } from 'vitest';
import { lineDiff } from './line-diff.ts';

const same = (text: string) => ({ kind: 'same', text });
const removed = (text: string) => ({ kind: 'removed', text });
const added = (text: string) => ({ kind: 'added', text });

describe('lineDiff', () => {
  it.each([
    ['equal texts are all the same', 'a\nb\nc\n', 'a\nb\nc\n', [same('a'), same('b'), same('c')]],
    ['one changed line is a removed line, then an added one', 'a\nb\nc\n', 'a\nB\nc\n', [same('a'), removed('b'), added('B'), same('c')]],
    ["Windows line endings on one side don't count as a change", 'a\r\nb\r\nc\r\n', 'a\nb\nc\n', [same('a'), same('b'), same('c')]],
    ["an old Mac line ending or a byte-order mark doesn't either", '\uFEFFa\rb', 'a\nb', [same('a'), same('b')]],
    ['an empty text gives every line as added', '', 'a\nb\n', [added('a'), added('b')]],
    ['everything removed', 'a\nb\n', '', [removed('a'), removed('b')]],
    ['a line added at the end', 'a\nb\n', 'a\nb\nc\n', [same('a'), same('b'), added('c')]],
    ['a line removed from the start', 'a\nb\nc\n', 'b\nc\n', [removed('a'), same('b'), same('c')]],
    [
      'a block of changes shows its removed lines first, then its added ones',
      'a\nb\nc\nd\n',
      'a\nB\nC\nd\n',
      [same('a'), removed('b'), removed('c'), added('B'), added('C'), same('d')],
    ],
    ['a blank line is a line', 'a\n\nb\n', 'a\nb\n', [same('a'), removed(''), same('b')]],
    ["a missing final line break doesn't count as a change", 'a\nb', 'a\nb\n', [same('a'), same('b')]],
  ])('%s', (_, from, to, expected) => {
    expect(lineDiff(from, to)).toEqual(expected);
  });

  it('keeps every line of both sides, in order', () => {
    const from = 'one\ntwo\nthree\nfour\nfive\n';
    const to = 'zero\ntwo\nfour\nfive\nsix\n';
    const diff = lineDiff(from, to);
    expect(diff.filter((l) => l.kind !== 'added').map((l) => l.text)).toEqual(from.trimEnd().split('\n'));
    expect(diff.filter((l) => l.kind !== 'removed').map((l) => l.text)).toEqual(to.trimEnd().split('\n'));
    // The longest run in common: two, four, five.
    expect(diff.filter((l) => l.kind === 'same').map((l) => l.text)).toEqual(['two', 'four', 'five']);
  });
});
