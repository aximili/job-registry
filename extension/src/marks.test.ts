import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import type { CardMark, ExactMatch } from '../../shared/contracts/index.ts';
import { drawMark, markText, removeMark } from './marks.ts';
import { savedText } from './panel/text.ts';
import type { FoundCard } from './sites/index.ts';

const NOW = new Date('2026-10-30T03:00:00Z');
const QUICK: CardMark = { kind: 'quick', verdict: 'good', score: 68, reason: 'Your React work matches the stack.' };
const FULL: CardMark = { kind: 'full', verdict: 'strong', score: 84, reason: 'You have led a team like this one.' };
const APPLIED: ExactMatch = { jobId: 7, title: 'Developer', company: 'Acme', status: 'applied', dateApplied: '2026-10-12' };
const HINT = 'Quick rating from the card. Open the job for a full rating.';

// One Seek-like card: the title is a heading, and the mark goes after it.
function seekCard(): FoundCard {
  const { document } = parseHTML(
    '<!doctype html><html><body><article><h3><a href="/job/81234567">Developer</a></h3><p>Acme</p></article></body></html>',
  );
  const element = document.querySelector('article') as unknown as Element;
  return {
    element,
    anchor: element.querySelector('h3')!,
    card: {
      canonicalUrl: 'https://www.seek.com.au/job/81234567',
      sourceSite: 'seek',
      externalId: '81234567',
      title: 'Developer',
      company: 'Acme',
      location: null,
      text: '',
    },
  };
}

const hostsIn = (found: FoundCard) => Array.from(found.element.querySelectorAll('[data-job-registry-mark]'));
// What a mark shows, and its tooltip, read through its (open, in these
// tests) shadow root.
const shown = (host: Element) => host.shadowRoot?.querySelector('.mark')?.textContent ?? null;
const tip = (host: Element) => host.shadowRoot?.querySelector('.mark')?.getAttribute('title') ?? null;

describe('markText', () => {
  it('a full rating says its verdict and score', () => {
    expect(markText({ kind: 'mark', mark: FULL })).toBe('Strong 84');
    expect(markText({ kind: 'mark', mark: { ...FULL, verdict: 'stretch', score: 45 } })).toBe('Stretch 45');
    expect(markText({ kind: 'mark', mark: { ...FULL, verdict: 'weak', score: 20 } })).toBe('Weak 20');
  });

  it('a quick rating says so', () => {
    expect(markText({ kind: 'mark', mark: QUICK })).toBe('Good 68 · quick');
  });

  it("a saved job uses the panel's wording, rated or not", () => {
    expect(markText({ kind: 'saved', saved: APPLIED, mark: null }, NOW)).toBe('Saved · Applied 12 Oct');
    expect(markText({ kind: 'saved', saved: APPLIED, mark: QUICK }, NOW)).toBe(savedText(APPLIED, NOW));
    expect(markText({ kind: 'saved', saved: { ...APPLIED, status: 'saved', dateApplied: null }, mark: null }, NOW)).toBe('Saved');
  });

  it('says "Rating…" while the AI reads the card', () => {
    expect(markText({ kind: 'rating' })).toBe('Rating…');
  });
});

describe('drawMark', () => {
  it('puts the mark right after the anchor, in a shadow root of its own', () => {
    const found = seekCard();
    drawMark(found, { kind: 'mark', mark: QUICK }, { open: true });
    const [host] = hostsIn(found);
    expect(found.anchor.nextElementSibling).toBe(host);
    expect(host!.tagName).toBe('SPAN');
    expect(shown(host!)).toBe('Good 68 · quick');
    // The card's own text doesn't change, so reading the card again reads the same card.
    expect(found.element.textContent).toBe('DeveloperAcme');
  });

  it("the shadow root is closed unless asked (the site's scripts can't read it)", () => {
    const found = seekCard();
    drawMark(found, { kind: 'mark', mark: QUICK });
    const [host] = hostsIn(found);
    expect(host).toBeDefined();
    expect(host!.shadowRoot).toBeNull();
  });

  it('sits above the card\'s own link, so its tooltip shows', () => {
    const found = seekCard();
    drawMark(found, { kind: 'mark', mark: QUICK }, { open: true });
    const style = (hostsIn(found)[0] as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain('position: relative');
    expect(style).toContain('z-index: 1');
    expect(style).toContain('display: inline-block');
  });

  it('the tooltip is the reason, plus a hint for a quick rating', () => {
    const quick = seekCard();
    drawMark(quick, { kind: 'mark', mark: QUICK }, { open: true });
    expect(tip(hostsIn(quick)[0]!)).toBe(`Your React work matches the stack.\n${HINT}`);

    const full = seekCard();
    drawMark(full, { kind: 'mark', mark: FULL }, { open: true });
    expect(tip(hostsIn(full)[0]!)).toBe('You have led a team like this one.');

    const noReason = seekCard();
    drawMark(noReason, { kind: 'mark', mark: { ...QUICK, reason: null } }, { open: true });
    expect(tip(hostsIn(noReason)[0]!)).toBe(HINT);
  });

  it("the element on the page carries none of the mark: the site's scripts can't read your rating", () => {
    const states = [
      { kind: 'mark', mark: QUICK },
      { kind: 'mark', mark: FULL },
      { kind: 'saved', saved: APPLIED, mark: QUICK },
      { kind: 'rating' },
    ] as const;
    for (const state of states) {
      const found = seekCard();
      drawMark(found, state, { open: true, now: NOW });
      const [host] = hostsIn(found);
      expect(host!.hasAttribute('title')).toBe(false);
      expect(host!.getAttributeNames().sort()).toEqual(['data-job-registry-mark', 'style']);
      for (const words of ['Good', '68', 'Strong', '84', 'Saved', 'Applied', 'Rating', 'React', 'led a team', 'Quick rating']) {
        expect(host!.outerHTML).not.toContain(words);
      }
    }
  });

  it("a saved job's tooltip gives its rating, if it has one", () => {
    const rated = seekCard();
    drawMark(rated, { kind: 'saved', saved: APPLIED, mark: QUICK }, { open: true, now: NOW });
    expect(shown(hostsIn(rated)[0]!)).toBe('Saved · Applied 12 Oct');
    expect(tip(hostsIn(rated)[0]!)).toBe(`Good 68 · quick\nYour React work matches the stack.\n${HINT}`);

    const unrated = seekCard();
    drawMark(unrated, { kind: 'saved', saved: APPLIED, mark: null }, { open: true, now: NOW });
    expect(tip(hostsIn(unrated)[0]!)).toBeNull();
  });

  it('drawing twice on one card leaves one mark, updated', () => {
    const found = seekCard();
    drawMark(found, { kind: 'rating' }, { open: true });
    drawMark(found, { kind: 'mark', mark: QUICK }, { open: true });
    const hosts = hostsIn(found);
    expect(hosts).toHaveLength(1);
    expect(shown(hosts[0]!)).toBe('Good 68 · quick');
    expect(found.anchor.nextElementSibling).toBe(hosts[0]);
  });

  it("a copy of the mark that the site made (it has no shadow root) is replaced, never doubled", () => {
    const found = seekCard();
    drawMark(found, { kind: 'mark', mark: QUICK }, { open: true });
    // The site redraws the card from a copy of itself, mark and all.
    const copy = found.element.cloneNode(true) as Element;
    found.element.replaceWith(copy);
    const redrawn: FoundCard = { ...found, element: copy, anchor: copy.querySelector('h3')! };
    expect(hostsIn(redrawn).map(shown)).toEqual([null]);
    drawMark(redrawn, { kind: 'mark', mark: QUICK }, { open: true });
    expect(hostsIn(redrawn).map(shown)).toEqual(['Good 68 · quick']);
  });

  it('removeMark takes the mark away', () => {
    const found = seekCard();
    drawMark(found, { kind: 'rating' }, { open: true });
    removeMark(found);
    expect(hostsIn(found)).toEqual([]);
  });
});
