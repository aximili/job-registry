import { describe, expect, it } from 'vitest';
import { DEFAULT_PLACE, MIN_HEIGHT, MIN_WIDTH, fit, moved, readPlace, resized } from './place.ts';

const view = { width: 1200, height: 800 };
// The panel in its usual corner: 320 wide, 300 tall, 16 from the right and bottom.
const box = { left: 864, top: 484, width: 320, height: 300 };

describe('moved', () => {
  it('follows the pointer, and keeps the size you chose', () => {
    expect(moved(box, -400, -200, view, DEFAULT_PLACE)).toEqual({ right: 416, bottom: 216, width: null, height: null });
    expect(moved(box, -10, 0, view, { ...DEFAULT_PLACE, width: 320, height: 300 })).toEqual({ right: 26, bottom: 16, width: 320, height: 300 });
  });

  it('stops at the edges of the window', () => {
    expect(moved(box, 500, 500, view, DEFAULT_PLACE)).toMatchObject({ right: 0, bottom: 0 });
    expect(moved(box, -5000, -5000, view, DEFAULT_PLACE)).toMatchObject({ right: 880, bottom: 500 });
  });
});

describe('resized', () => {
  it('from the top-left corner, grows up and left, and the bottom-right corner stays put', () => {
    expect(resized(box, 'nw', -100, -50, view, DEFAULT_PLACE)).toEqual({ right: 16, bottom: 16, width: 420, height: 350 });
  });

  it('from the bottom-right corner, grows down and right', () => {
    expect(resized(box, 'se', 10, 6, view, DEFAULT_PLACE)).toEqual({ right: 6, bottom: 10, width: 330, height: 306 });
  });

  it('from one edge, changes only that side, and the other size stays as it was', () => {
    expect(resized(box, 'w', -80, 999, view, DEFAULT_PLACE)).toEqual({ right: 16, bottom: 16, width: 400, height: null });
    expect(resized(box, 'n', 999, -40, view, { ...DEFAULT_PLACE, width: 320 })).toEqual({ right: 16, bottom: 16, width: 320, height: 340 });
  });

  it('never goes smaller than the least size, or past the window', () => {
    expect(resized(box, 'nw', 900, 900, view, DEFAULT_PLACE)).toMatchObject({ width: MIN_WIDTH, height: MIN_HEIGHT });
    expect(resized(box, 'nw', -5000, -5000, view, DEFAULT_PLACE)).toEqual({ right: 16, bottom: 16, width: 1184, height: 784 });
    expect(resized(box, 'se', 5000, 5000, view, DEFAULT_PLACE)).toEqual({ right: 0, bottom: 0, width: 336, height: 316 });
  });
});

describe('fit', () => {
  it('shows the panel where you left it when it fits', () => {
    expect(fit({ right: 40, bottom: 30, width: null, height: null }, { width: 320, height: 300 }, view)).toEqual({ right: 40, bottom: 30 });
  });

  it('moves it back inside a window that has shrunk, or when it grows taller', () => {
    expect(fit({ right: 1000, bottom: 700, width: null, height: null }, { width: 320, height: 300 }, view)).toEqual({ right: 880, bottom: 500 });
  });

  it('puts it in the corner when it is bigger than the window', () => {
    expect(fit({ right: 50, bottom: 50, width: 2000, height: 2000 }, { width: 1300, height: 900 }, view)).toEqual({ right: 0, bottom: 0 });
  });
});

describe('readPlace', () => {
  it('reads a saved place', () => {
    expect(readPlace({ right: 40, bottom: 30, width: 400, height: null })).toEqual({ right: 40, bottom: 30, width: 400, height: null });
  });

  it('falls back to the usual corner for anything else', () => {
    expect(readPlace(undefined)).toEqual(DEFAULT_PLACE);
    expect(readPlace('left')).toEqual(DEFAULT_PLACE);
    expect(readPlace({ right: -5, bottom: 'x' })).toEqual(DEFAULT_PLACE);
    expect(readPlace({ right: 40, bottom: 30, width: Number.NaN, height: 10 })).toEqual({ right: 40, bottom: 30, width: null, height: MIN_HEIGHT });
  });
});
