// The light fact-check: plain code, not AI (docs/decisions/0010). It finds the
// facts in a draft that a reader would check (numbers, percentages, money,
// years, date ranges and capitalised names) and flags the ones your master
// profile doesn't have. It's a helper, never a gate: nothing waits on it.

import { phoneDigits } from './phone.ts';

export type FactKind = 'number' | 'percent' | 'money' | 'year' | 'range' | 'name';
export type Flag = { text: string; kind: FactKind };

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DASH = '[-‐-―−]';
const NOT_GLUED = '(?<![\\p{L}\\p{N}])';

// One pass over the text, first match wins at each place, so a range is never
// also read as two years, and a phone number never as three numbers.
const FACTS = new RegExp(
  [
    `(?<date>${NOT_GLUED}\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+\\d{4}(?!\\d))`,
    `(?<range>${NOT_GLUED}(?:${MONTH}\\.?\\s+)?\\d{4}\\s*${DASH}\\s*(?:(?:${MONTH}\\.?\\s+)?\\d{4}(?!\\d)|present\\b|current\\b|now\\b|today\\b))`,
    `(?<money>\\$\\s?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:k|m|bn|b|million|billion)(?![\\p{L}]))?)`,
    `(?<percent>${NOT_GLUED}\\d+(?:[.,]\\d+)?\\s?%)`,
    // A phone number, but never a year range in brackets such as (2019-2021).
    `(?<phone>(?<![\\p{L}\\p{N}+])(?!\\(?(?:19|20)\\d{2}\\s*${DASH})\\+?\\(?\\d(?:[ ()-]*\\d){7,}(?!\\d))`,
    `(?<year>${NOT_GLUED}(?:19|20)\\d{2}(?![\\p{L}\\p{N}]))`,
    `(?<number>${NOT_GLUED}\\d+(?:[.,]\\d+)*(?:\\+|x(?![\\p{L}]))?(?![\\p{L}\\p{N}]|[.,]\\d))`,
  ].join('|'),
  'giu',
);

// Words that never count as a name: resume headings, letter words, months,
// days and Australian states.
const COMMON = new Set(
  (
    'i dear hiring sincerely regards kind yours re thank thanks ' +
    'summary professional profile experience work employment history skills key core technical education ' +
    'certifications certification projects achievements career references available upon request contact ' +
    'phone mobile email present current linkedin github remote hybrid resume cover letter objective highlights ' +
    'selected relevant other interests languages awards volunteering personal details about me ' +
    'competencies expertise areas qualifications training tools technologies strengths accomplishments memberships publications ' +
    'referees referee additional information leadership frameworks development platforms methodologies ' +
    'january february march april may june july august september october november december ' +
    'jan feb mar apr jun jul aug sep sept oct nov dec ' +
    'monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun ' +
    'nsw vic qld wa sa tas act nt'
  ).split(' '),
);

// Who a letter is addressed to. "Manager" and "Team" on their own can be part
// of a job title you might not have had, so only these phrases are ignored.
const ADDRESSEES = /\b(?:hiring|recruitment|recruiting|selection)\s+(?:manager|managers|team|panel|committee)\b|\btalent\s+acquisition\s+team\b/giu;

// Small words that may sit inside a name: "Department of Health".
const CONNECTORS = new Set(['of', 'for', 'de', 'van', 'von', 'der', 'la']);

// Words that often start a sentence in a resume or letter: verbs, and small
// words. At a sentence start these are dropped; any other capitalised first
// word ("Globex hired me") counts as a name.
const STARTERS = new Set(
  (
    'a an the my our this that these those it its we they he she you your in at on for with as by from to of after before ' +
    'during since over under across through within when while where if each every both all most many some also then now ' +
    'today currently previously recently however additionally finally overall together here there please see call up based ' +
    'led managed built designed developed delivered created drove improved increased reduced cut grew launched implemented ' +
    'owned ran worked wrote moved migrated mentored coached partnered collaborated supported introduced established automated ' +
    'architected shipped defined oversaw set scaled saved won achieved helped joined started completed contributed responsible ' +
    'experienced skilled proven strong keen excited happy looking having being working leading building delivering passionate'
  ).split(' '),
);

// "ten years": numbers written as words, checked like digits.
const DRAFT_NUMBER_WORDS = /(?<![\p{L}-])(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)(?=\s+\p{L})/giu;

// A title's first word is part of the claim ("Lead Data Analyst"), never just
// the capital that starts a sentence.
const SENIORITY = new Set(['lead', 'principal', 'head', 'chief', 'staff', 'senior', 'junior', 'director']);

const NUMBER_WORDS = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ');

const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+/;

// Markdown and links aren't facts: keep a link's words, drop its address.
// Also says where the heading lines are: a heading is a line of its own, so
// its first word is never just the capital that starts a sentence.
function plainText(md: string): { text: string; headings: [number, number][] } {
  const headings: [number, number][] = [];
  let offset = 0;
  const lines = md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .split('\n')
    .map((line) => {
      const plain = line
        .replace(HEADING, '')
        .replace(/^[ \t]*>[ \t]?/, '')
        .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/, '')
        .replace(/[*_`~]/g, ' ');
      if (HEADING.test(line)) headings.push([offset, offset + plain.length]);
      offset += plain.length + 1;
      return plain;
    });
  return { text: lines.join('\n'), headings };
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(new RegExp(DASH, 'g'), '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+%/g, '%')
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/(['])s\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(text: string): number {
  return Number(text.replace(/[,\s]/g, ''));
}

function moneyValue(text: string): number {
  const match = /([\d,]+(?:\.\d+)?)\s?(k|m|bn|b|million|billion)?/i.exec(text);
  if (!match) return NaN;
  const scale: Record<string, number> = { k: 1e3, m: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };
  return toNumber(match[1]!) * (scale[match[2]?.toLowerCase() ?? ''] ?? 1);
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return true;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, 'u').test(haystack);
}

// A date range by its parts, so "Mar 2020 – Present" and "March 2020 – current"
// are the same. A month is 0–11, or null when the range gives only the year.
type Range = { startMonth: number | null; startYear: number; endMonth: number | null; endYear: number | 'present' };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const RANGE_PARTS = new RegExp(
  `^(?:(${MONTH})\\.?\\s+)?(\\d{4})\\s*${DASH}\\s*(?:(?:(${MONTH})\\.?\\s+)?(\\d{4})|(present|current|now|today))$`,
  'iu',
);

function parseRange(text: string): Range | null {
  const m = RANGE_PARTS.exec(text.trim());
  if (!m) return null;
  const month = (name: string | undefined) => (name ? MONTHS.indexOf(name.slice(0, 3).toLowerCase()) : null);
  return { startMonth: month(m[1]), startYear: Number(m[2]), endMonth: month(m[3]), endYear: m[5] ? 'present' : Number(m[4]) };
}

// The draft's range is the profile's when the years match, and the months
// too wherever the draft gives one.
function sameRange(draft: Range, profile: Range): boolean {
  return (
    draft.startYear === profile.startYear &&
    draft.endYear === profile.endYear &&
    (draft.startMonth === null || draft.startMonth === profile.startMonth) &&
    (draft.endMonth === null || draft.endMonth === profile.endMonth)
  );
}

type Facts = { numbers: Set<number>; percents: Set<number>; money: Set<number>; ranges: Range[]; phones: Set<string> };

type Found = { kind: FactKind | 'date' | 'phone'; text: string; index: number };

function findFacts(text: string): Found[] {
  const found: Found[] = [];
  for (const m of text.matchAll(FACTS)) {
    const kind = (Object.keys(m.groups!) as Found['kind'][]).find((k) => m.groups![k] !== undefined)!;
    found.push({ kind, text: m[0].trim(), index: m.index });
  }
  return found;
}

function profileFacts(profile: string): Facts {
  const facts: Facts = { numbers: new Set(), percents: new Set(), money: new Set(), ranges: [], phones: new Set() };
  for (const f of findFacts(profile)) {
    if (f.kind === 'percent') facts.percents.add(toNumber(f.text.replace('%', '')));
    else if (f.kind === 'money') facts.money.add(moneyValue(f.text));
    else if (f.kind === 'range') {
      const range = parseRange(f.text);
      if (range) facts.ranges.push(range);
    }
    else if (f.kind === 'phone') facts.phones.add(phoneDigits(f.text));
  }
  // Any plain number, including the years inside ranges and dates.
  for (const m of profile.matchAll(/(?<![\d.,])\d+(?:,\d{3})*(?:\.\d+)?(?![\d])/g)) facts.numbers.add(toNumber(m[0]));
  for (const m of profile.toLowerCase().matchAll(/\b[a-z]+\b/g)) {
    const n = NUMBER_WORDS.indexOf(m[0]);
    if (n !== -1) facts.numbers.add(n);
  }
  return facts;
}

type Word = {
  text: string;
  index: number;
  // Where the word ends in the text (after a possessive is dropped).
  end: number;
  key: string;
  startsSentence: boolean;
  inHeading: boolean;
  isName: boolean;
  isStrong: boolean;
};

const WORD = /[\p{L}\p{N}](?:[\p{L}\p{N}+#]|[.'’&-](?=[\p{L}\p{N}]))*/gu;

function readWords(text: string, headings: [number, number][]): Word[] {
  const words: Word[] = [];
  for (const m of text.matchAll(WORD)) {
    // Possessives and contractions: "Co's" → "Co", "I'd" → "I".
    const raw = m[0].replace(/['’](?:s|d|m|ve|ll|re)$/i, '');
    const before = text.slice(0, m.index).replace(/["'‘“(\[\s]+$/u, '');
    const last = before.at(-1);
    words.push({
      text: raw,
      index: m.index,
      end: m.index + raw.length,
      key: normalise(raw),
      startsSentence: last === undefined || last === '\n' || /[.!?]/.test(last) || /\n\s*$/.test(text.slice(0, m.index)),
      inHeading: headings.some(([from, to]) => m.index >= from && m.index < to),
      isName: /^\p{Lu}/u.test(raw) || /\p{Ll}\p{Lu}/u.test(raw),
      isStrong: /^\p{Lu}{2,}/u.test(raw) || /\d/.test(raw) || /\p{Ll}\p{Lu}/u.test(raw),
    });
  }
  return words;
}

// Runs of capitalised words: "Example Co", "AWS Certified Solutions Architect",
// "Procter & Gamble". A run ends at anything but spaces (or an "&") between
// two words, so "Commerce (Finance)" is two names, as it reads.
function nameRuns(words: Word[], text: string): Word[][] {
  const runs: Word[][] = [];
  let run: Word[] = [];
  const end = () => {
    while (run.length > 0 && CONNECTORS.has(run.at(-1)!.key)) run.pop();
    if (run.length > 0) runs.push(run);
    run = [];
  };
  words.forEach((word, i) => {
    const isPart = word.isName && !COMMON.has(word.key);
    const isConnector = run.length > 0 && CONNECTORS.has(word.key) && words[i + 1]?.isName === true;
    if (isPart || isConnector) {
      const previous = run.at(-1);
      if (previous && (word.startsSentence || !/^[ \t]*(?:&[ \t]*)?$/.test(text.slice(previous.end, word.index)))) end();
      run.push(word);
    } else end();
  });
  end();
  return runs;
}

export function createFactChecker(profile: string, allow: string[] = []): (draft: string) => Flag[] {
  const profileText = normalise(plainText(profile).text);
  // Words the profile has in lower case: a verb such as "managed" is no name.
  const profileLower = new Set([...profile.matchAll(/\p{L}+/gu)].map((m) => m[0]).filter((w) => w === w.toLowerCase()));
  const facts = profileFacts(profile);
  const allowText = allow.map((a) => normalise(a)).filter(Boolean).join(' | ');

  const knownName = (key: string): boolean => containsPhrase(profileText, key) || containsPhrase(allowText, key);

  function checkFact(f: Found): boolean {
    switch (f.kind) {
      case 'date':
        return true;
      case 'percent':
        return facts.percents.has(toNumber(f.text.replace('%', '')));
      case 'money':
        return facts.money.has(moneyValue(f.text));
      case 'range': {
        const range = parseRange(f.text);
        return range ? facts.ranges.some((r) => sameRange(range, r)) : containsPhrase(profileText, normalise(f.text));
      }
      case 'phone':
        return facts.phones.has(phoneDigits(f.text));
      default:
        return facts.numbers.has(toNumber(f.text.replace(/[+x]$/, '')));
    }
  }

  return (draft) => {
    const flags: Flag[] = [];
    const seen = new Set<string>();
    const flag = (text: string, kind: FactKind) => {
      const key = `${kind}:${normalise(text)}`;
      if (seen.has(key)) return;
      seen.add(key);
      flags.push({ text, kind });
    };

    const { text, headings } = plainText(draft);
    const found = findFacts(text);
    const blank = (s: string, from: number, length: number) => s.slice(0, from) + ' '.repeat(length) + s.slice(from + length);
    let masked = text;
    for (const f of found) masked = blank(masked, f.index, f.text.length);
    for (const m of text.matchAll(ADDRESSEES)) masked = blank(masked, m.index, m[0].length);

    const ordered: { index: number; run: () => void }[] = [];
    for (const f of found) {
      if (!checkFact(f)) ordered.push({ index: f.index, run: () => flag(f.text, f.kind === 'phone' ? 'number' : (f.kind as FactKind)) });
    }
    for (const m of masked.matchAll(DRAFT_NUMBER_WORDS)) {
      const value = NUMBER_WORDS.indexOf(m[0].toLowerCase());
      if (!facts.numbers.has(value)) ordered.push({ index: m.index, run: () => flag(m[0], 'number') });
    }
    const draftLower = new Set([...masked.matchAll(/\p{L}+/gu)].map((m) => m[0]).filter((w) => w === w.toLowerCase()));
    // At a sentence start, a first word is dropped only when it reads as an
    // ordinary word, and never when it's a label ("Deloitte:", "Telstra |"),
    // one of a list ("Python, Go") or a line of its own ("- Kubernetes").
    const ordinaryStart = (word: Word): boolean => {
      const next = /^[ \t]*(\S?)/.exec(text.slice(word.end))?.[1] ?? '';
      if (next === '' || /[:|,\u2013\u2014-]/.test(next)) return false;
      return STARTERS.has(word.key) || profileLower.has(word.key) || draftLower.has(word.key);
    };

    // The words as they stand in the draft, so the preview can highlight them.
    const span = (words: Word[]) => text.slice(words[0]!.index, words.at(-1)!.end).replace(/\s+/g, ' ');
    for (const run of nameRuns(readWords(masked, headings), masked)) {
      if (knownName(normalise(span(run)))) continue;
      let rest = run;
      const first = run[0]!;
      if (first.startsSentence && !first.inHeading && !first.isStrong && !SENIORITY.has(first.key) && ordinaryStart(first)) {
        rest = run.slice(1);
        while (rest.length > 0 && CONNECTORS.has(rest[0]!.key)) rest = rest.slice(1);
        if (rest.length === 0) continue;
        if (knownName(normalise(span(rest)))) continue;
      }
      const label = span(rest);
      ordered.push({ index: rest[0]!.index, run: () => flag(label, 'name') });
    }

    ordered.sort((a, b) => a.index - b.index);
    for (const o of ordered) o.run();
    return flags;
  };
}

export function factCheck(draft: string, profile: string, allow: string[] = []): Flag[] {
  return createFactChecker(profile, allow)(draft);
}
