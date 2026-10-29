// One job card's mark on a search list: "Strong 84", "Good 68 · quick",
// "Saved · Applied 12 Oct", or "Rating…" while the AI reads the card. It
// goes right after the card's title, in a shadow root of its own, so the
// site's CSS can't touch it and reading the card again never reads the mark.

import type { CardMark, ExactMatch, Verdict } from '../../shared/contracts/index.ts';
import { SHADOW_MODE } from './panel/shadow.ts';
import { savedText } from './panel/text.ts';
import type { FoundCard } from './sites/index.ts';

export type MarkState =
  | { kind: 'rating' }
  | { kind: 'mark'; mark: CardMark }
  | { kind: 'saved'; saved: ExactMatch; mark: CardMark | null };

const ATTR = 'data-job-registry-mark';
const QUICK_HINT = 'Quick rating from the card. Open the job for a full rating.';
const WORD: Record<Verdict, string> = { strong: 'Strong', good: 'Good', stretch: 'Stretch', weak: 'Weak' };

// "all: initial" keeps the site's styles off the mark. It sits above the
// card's own link (Seek's whole card is one), so its tooltip shows. The
// element on the page holds nothing else: the mark's words and its tooltip
// are inside the closed shadow root, where the site's scripts can't read them.
const HOST_STYLE = 'all: initial; display: inline-block; position: relative; z-index: 1; vertical-align: middle; margin: 2px 6px;';

// The panel's colours: green for strong and good, red for weak.
const STYLE = `
.mark {
  display: inline-block;
  padding: 0 6px;
  border: 1px solid #d8dde5;
  border-radius: 4px;
  background: #ffffff;
  color: #1b2330;
  font: 600 12px/18px system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.strong, .good { color: #1a7f37; }
.weak { color: #b3261e; }
.rating { color: #4e5a6a; font-weight: 400; }
@media (prefers-color-scheme: dark) {
  .mark { background: #161b24; border-color: #2c3442; color: #e6e9ef; }
  .strong, .good { color: #6fd58a; }
  .weak { color: #ff8a80; }
  .rating { color: #9aa6b6; }
}
`;

// The marks this script drew, and what each one shows. A copy of a mark
// that the site made (it redrew the card from a copy of itself) isn't here:
// it has no shadow root, so it's replaced.
const drawn = new WeakMap<Element, { text: HTMLElement; shows: string }>();

export function markText(state: MarkState, now: Date = new Date()): string {
  if (state.kind === 'rating') return 'Rating…';
  if (state.kind === 'saved') return savedText(state.saved, now);
  return `${WORD[state.mark.verdict]} ${state.mark.score}${state.mark.kind === 'quick' ? ' · quick' : ''}`;
}

// The tooltip: the AI's reason, and for a quick rating, what "quick" means.
// A saved job's mark doesn't show its rating, so the tooltip does.
function tooltip(state: MarkState): string {
  if (state.kind === 'rating' || !state.mark) return '';
  const { mark } = state;
  const lines = [
    state.kind === 'saved' ? markText({ kind: 'mark', mark }) : null,
    mark.reason,
    mark.kind === 'quick' ? QUICK_HINT : null,
  ];
  return lines.filter((line): line is string => !!line).join('\n');
}

function tone(state: MarkState): string {
  if (state.kind === 'rating') return 'rating';
  if (state.kind === 'saved') return 'saved';
  return state.mark.verdict;
}

// The card's marks: those inside it, and the one right after its title.
function hostsOf(found: FoundCard): Element[] {
  const hosts = Array.from(found.element.querySelectorAll(`[${ATTR}]`));
  const next = found.anchor.nextElementSibling;
  if (next?.hasAttribute(ATTR) && !hosts.includes(next)) hosts.push(next);
  return hosts;
}

function newHost(doc: Document, open: boolean): Element {
  const host = doc.createElement('span');
  host.setAttribute(ATTR, '');
  host.style.cssText = HOST_STYLE;
  const root = host.attachShadow({ mode: open ? 'open' : 'closed' });
  const style = doc.createElement('style');
  style.textContent = STYLE;
  const text = doc.createElement('span');
  root.append(style, text);
  drawn.set(host, { text, shows: '' });
  return host;
}

// Adds the card's mark, or updates the one it has. Never two on one card.
// open: an open shadow root, for tests (the browser tests' build opens them all).
export function drawMark(found: FoundCard, state: MarkState, opts: { open?: boolean; now?: Date } = {}): void {
  const hosts = hostsOf(found);
  const kept = hosts.find((h) => drawn.has(h)) ?? null;
  for (const h of hosts) if (h !== kept) h.remove();
  const host = kept ?? newHost(found.anchor.ownerDocument, opts.open ?? SHADOW_MODE === 'open');
  if (found.anchor.nextElementSibling !== host) found.anchor.after(host);
  const mark = drawn.get(host)!;
  const text = markText(state, opts.now);
  const title = tooltip(state);
  const shows = `${tone(state)}\n${text}\n${title}`;
  if (mark.shows === shows) return;
  mark.shows = shows;
  mark.text.className = `mark ${tone(state)}`;
  mark.text.textContent = text;
  if (title) mark.text.setAttribute('title', title);
  else mark.text.removeAttribute('title');
}

export function removeMark(found: FoundCard): void {
  for (const host of hostsOf(found)) host.remove();
}
