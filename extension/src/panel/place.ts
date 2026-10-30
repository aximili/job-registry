// Where the panel sits and how big it is. You move it by its top bar and
// resize it from any edge or corner, and the extension keeps that for every
// page. It's kept as the distance from the right and bottom of the window,
// where the panel starts, so it stays in its corner when the window changes
// size. width and height are null until you resize that way: the panel then
// sizes itself, as it always has.

export type PanelPlace = { right: number; bottom: number; width: number | null; height: number | null };
// The panel's box on screen (from getBoundingClientRect), and the window's size.
export type Box = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const DEFAULT_PLACE: PanelPlace = { right: 16, bottom: 16, width: null, height: null };
export const MIN_WIDTH = 260;
export const MIN_HEIGHT = 120;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

function placeOf(left: number, top: number, width: number, height: number, view: Size): Pick<PanelPlace, 'right' | 'bottom'> {
  return { right: Math.round(view.width - left - width), bottom: Math.round(view.height - top - height) };
}

// Dragging the bar: the panel follows the pointer, but stays in the window.
export function moved(box: Box, dx: number, dy: number, view: Size, place: PanelPlace): PanelPlace {
  const left = clamp(box.left + dx, 0, view.width - box.width);
  const top = clamp(box.top + dy, 0, view.height - box.height);
  return { ...place, ...placeOf(left, top, box.width, box.height, view) };
}

// Dragging an edge or a corner: that side follows the pointer, and the
// opposite side stays put. Only the sizes you drag are set.
export function resized(box: Box, edge: Edge, dx: number, dy: number, view: Size, place: PanelPlace): PanelPlace {
  let { left, top, width, height } = box;
  const next = { ...place };
  if (edge.includes('w')) {
    left = clamp(box.left + dx, 0, box.left + box.width - MIN_WIDTH);
    width = box.left + box.width - left;
  } else if (edge.includes('e')) {
    width = clamp(box.width + dx, MIN_WIDTH, view.width - box.left);
  }
  if (edge.includes('n')) {
    top = clamp(box.top + dy, 0, box.top + box.height - MIN_HEIGHT);
    height = box.top + box.height - top;
  } else if (edge.includes('s')) {
    height = clamp(box.height + dy, MIN_HEIGHT, view.height - box.top);
  }
  if (edge.includes('w') || edge.includes('e')) next.width = Math.round(width);
  if (edge.includes('n') || edge.includes('s')) next.height = Math.round(height);
  return { ...next, ...placeOf(left, top, width, height, view) };
}

// Where to show the panel now: where you left it, moved just enough to keep
// it all in the window (the window may have shrunk, or the panel grown).
export function fit(place: PanelPlace, size: Size, view: Size): Pick<PanelPlace, 'right' | 'bottom'> {
  return {
    right: clamp(place.right, 0, view.width - size.width),
    bottom: clamp(place.bottom, 0, view.height - size.height),
  };
}

// A place read back from the browser's storage. Anything odd means the usual corner.
export function readPlace(value: unknown): PanelPlace {
  if (!value || typeof value !== 'object') return DEFAULT_PLACE;
  const v = value as Record<string, unknown>;
  const offset = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!offset(v.right) || !offset(v.bottom)) return DEFAULT_PLACE;
  const size = (n: unknown, min: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(min, n) : null);
  return { right: v.right as number, bottom: v.bottom as number, width: size(v.width, MIN_WIDTH), height: size(v.height, MIN_HEIGHT) };
}
