import { describe, expect, it } from 'vitest';
import type { DiffLine } from '../../../shared/contracts/index.ts';
import { foldDiff } from './starter-diff.ts';

const same = (text: string): DiffLine => ({ kind: 'same', text });
const removed = (text: string): DiffLine => ({ kind: 'removed', text });
const added = (text: string): DiffLine => ({ kind: 'added', text });
const sames = (from: number, to: number): DiffLine[] => Array.from({ length: to - from + 1 }, (_, i) => same(`line ${from + i}`));

// A short picture of the result: each line as "  text", "- text" or "+ text",
// and each fold as "[n]".
function picture(diff: DiffLine[], context?: number): string[] {
  return foldDiff(diff, context).map((part) =>
    part.kind === 'fold' ? `[${part.lines.length}]` : `${{ same: ' ', removed: '-', added: '+' }[part.line.kind]} ${part.line.text}`,
  );
}

describe('foldDiff', () => {
  it('keeps two unchanged lines either side of a change, and folds the rest', () => {
    const diff = [...sames(1, 10), removed('old'), added('new'), ...sames(11, 20)];
    expect(picture(diff)).toEqual(['[8]', '  line 9', '  line 10', '- old', '+ new', '  line 11', '  line 12', '[8]']);
  });

  it('folds the run between two changes, keeping the lines beside each', () => {
    const diff = [removed('a'), ...sames(1, 9), added('b')];
    expect(picture(diff)).toEqual(['- a', '  line 1', '  line 2', '[5]', '  line 8', '  line 9', '+ b']);
  });

  it("shows a run in full when folding it would hide fewer than two lines", () => {
    const between = [removed('a'), ...sames(1, 5), added('b')];
    expect(picture(between)).toEqual(['- a', '  line 1', '  line 2', '  line 3', '  line 4', '  line 5', '+ b']);
    const leading = [...sames(1, 3), added('b')];
    expect(picture(leading)).toEqual(['  line 1', '  line 2', '  line 3', '+ b']);
  });

  it('folds a long run at the start or the end', () => {
    expect(picture([...sames(1, 6), added('b')])).toEqual(['[4]', '  line 5', '  line 6', '+ b']);
    expect(picture([removed('a'), ...sames(1, 6)])).toEqual(['- a', '  line 1', '  line 2', '[4]']);
  });

  it('keeps the fold in order, with the lines it hides', () => {
    const diff = [...sames(1, 5), added('b')];
    const [fold] = foldDiff(diff);
    expect(fold).toEqual({ kind: 'fold', lines: sames(1, 3) });
  });

  it('takes another number of lines to keep', () => {
    const diff = [...sames(1, 5), removed('old'), ...sames(6, 10)];
    expect(picture(diff, 1)).toEqual(['[4]', '  line 5', '- old', '  line 6', '[4]']);
  });

  it('folds a diff with no changes into one run, and an empty diff into nothing', () => {
    expect(picture(sames(1, 4))).toEqual(['[4]']);
    expect(foldDiff([])).toEqual([]);
  });
});
