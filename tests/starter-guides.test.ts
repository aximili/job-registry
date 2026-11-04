// The starter guides are read by the AI on every resume and cover letter, so
// they must stay short, keep the rules a small model needs, and never hold a
// real person's or company's name.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const LETTER = read('starters/profile/cover-letter-guide.md');
const RESUME = read('starters/profile/resume-guide.md');

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
// Case, curly apostrophes and line breaks don't count.
const flat = (text: string) => text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').toLowerCase();
const has = (text: string, phrase: string) => flat(text).includes(flat(phrase));
// The one line that starts with this text, or '' when there's none.
const lineStarting = (text: string, start: string) => text.split('\n').find((l) => l.startsWith(start)) ?? '';

// An answer to the brief's questions can settle a "To confirm" or ⚠ item,
// but never a "Don't claim" item.
const SETTLED = '"Don\'t claim" items always, and the "To confirm" and ⚠ items unless my answers settle them';

describe('the cover-letter guide', () => {
  it('is no longer than the old one (1,441 words) and keeps the 250 to 400 word limit', () => {
    expect(wordCount(LETTER)).toBeLessThanOrEqual(1_441);
    expect(LETTER).toContain('250 to 400 words');
  });

  it("drops the old lines about questions and a gap's plan", () => {
    expect(has(LETTER, "You can't ask me questions here")).toBe(false);
    expect(has(LETTER, 'Never skip the plan')).toBe(false);
  });

  it.each([
    ['a first name in the email is the name', 'first name in their email counts as their name'],
    ['the email example', '"Dear Sam,"'],
    ["a recruiter's ad goes to the recruiter", 'write to the recruiter'],
    ["the opening is the ad's most telling line", "the ad's most telling line, in its own words"],
    ['the opening never restates the skills list', 'never restate the skills list'],
    ['one story per need', 'one short story per need'],
    ["the stories are for the brief's needs, when there's a brief", "the brief's needs"],
    ['a story has the problem, what I did and the result', 'the problem, what I did, and the result'],
    ['clients and products are named', 'name the client and the product as my profile allows'],
    ['no strings of tool names', 'no strings of tool names'],
    ['a missing must-have goes near the end', 'near the end, just before the close'],
    ['a gap gets self-study as evidence', 'including any self-study my profile records'],
    ['a gap gets no stock plan', 'no stock plan'],
    ['answers and the brief are facts', 'my answers and the approved brief, when given'],
    ['answers settle "To confirm" and ⚠ items, never "Don\'t claim"', SETTLED],
    ['an approved brief is the plan', "an approved brief is given, it's the plan"],
    ['an approved brief replaces Step 1', 'in place of this step'],
    ["a government ad's separate statement keeps the criteria out of the letter", "don't answer the criteria in the letter"],
  ])('says %s', (_, phrase) => {
    expect(has(LETTER, phrase), phrase).toBe(true);
  });

  it("uses contractions, and says so: I'm, I've, I'd", () => {
    const line = LETTER.split('\n').find((l) => /contractions/i.test(l)) ?? '';
    for (const word of ["I'm", "I've", "I'd"]) expect(line).toContain(word);
  });

  it("puts the ad's instructions above this guide in Facts come first, not under Length", () => {
    const facts = LETTER.slice(LETTER.indexOf('## Facts come first'), LETTER.indexOf('## Step 1'));
    const length = LETTER.slice(LETTER.indexOf('### Length'), LETTER.indexOf('### Layout'));
    expect(facts).toContain("The ad's instructions beat this guide.");
    expect(length).not.toContain("The ad's instructions beat this guide.");
  });

  it('says to follow the brief in Step 1, not somewhere else', () => {
    const step1 = LETTER.slice(LETTER.indexOf('## Step 1'), LETTER.indexOf('## Step 2'));
    expect(has(step1, 'in place of this step')).toBe(true);
  });

  it("names the recruiter's firm in the Re: line when the ad doesn't name its client", () => {
    const re = lineStarting(LETTER, '4. `**Re:');
    expect(has(re, "the recruiter's firm")).toBe(true);
  });

  it('puts the link to the employer in the close when the opening has not made it, not in a paragraph of its own', () => {
    expect(has(lineStarting(LETTER, '5. **Close'), "if the opening hasn't")).toBe(true);
    expect(LETTER).not.toMatch(/^\d\. \*\*Fit/m);
  });
});

describe('the resume guide', () => {
  it('is no longer than the old one (1,871 words)', () => {
    expect(wordCount(RESUME)).toBeLessThanOrEqual(1_871);
  });

  it("takes my answers and the brief as facts, in place of the old \"can't ask me questions\" line", () => {
    expect(has(RESUME, "You can't ask me questions here")).toBe(false);
    expect(has(RESUME, 'my answers and the approved brief, when given')).toBe(true);
    expect(has(RESUME, SETTLED)).toBe(true);
  });

  it('checks that every fact comes from me, not only from my profile', () => {
    const check = lineStarting(RESUME, '6. **Facts:**');
    expect(has(check, 'comes from me,')).toBe(true);
    expect(has(check, 'comes from my profile')).toBe(false);
  });
});

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// True when any word, or any two neighbouring words, has a hash in the list.
// Words are lower case, letters and digits only.
function holdsName(text: string, hashes: Set<string>): boolean {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((word, i) => hashes.has(sha256(word)) || (i + 1 < words.length && hashes.has(sha256(`${word} ${words[i + 1]}`))));
}

// Every file in a folder and the folders under it. None when it's missing.
function filesIn(dir: string): string[] {
  const path = join(root, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesIn(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

// The SHA-256 of each real name from the user's own inputs (one word, or two
// joined by one space, in lower case). The list stays off git: a hash of a
// common name or an employer can be confirmed by guessing. Without it, only
// this check is skipped.
const HASHES_FILE = join(root, '.superpowers', 'real-name-hashes.json');
const REAL_NAMES = existsSync(HASHES_FILE) ? new Set<string>(JSON.parse(readFileSync(HASHES_FILE, 'utf8'))) : null;

// A real public LinkedIn page, with real company names on it.
const REAL_PAGE = join('tests', 'fixtures', 'sites', 'linkedin-guest-search.html');
const SCANNED = [
  'starters/profile/cover-letter-guide.md',
  'starters/profile/resume-guide.md',
  ...filesIn('server/modules/ai/prompts').filter((f) => f.endsWith('.md')),
  ...filesIn('tests/fixtures').filter((f) => f !== REAL_PAGE),
  'tests/fakes/smart-fake-ai.ts',
];

describe('no real names', () => {
  it('the check finds a name as a word or as two words, in any case and between any marks', () => {
    const made = new Set([sha256('sam taylor'), sha256('examplecorp')]);
    expect(holdsName('Dear SAM-Taylor,', made)).toBe(true);
    expect(holdsName('I worked at ExampleCorp.', made)).toBe(true);
    expect(holdsName('Sam wrote to Taylor.', made)).toBe(false);
    expect(holdsName('Dear Sam,', made)).toBe(false);
  });

  it.skipIf(!REAL_NAMES)(
    'none in the guides, the prompts, the fixtures or the smart fake (skipped on a PC without .superpowers/real-name-hashes.json, which git never holds)',
    () => {
      expect(SCANNED.length).toBeGreaterThan(30);
      const found = SCANNED.filter((file) => holdsName(read(file), REAL_NAMES!));
      expect(found, "These files hold a real name from the user's inputs. Find it with the hash list, and use a made-up one (Sam Taylor, Example Co).").toEqual([]);
    },
  );
});
