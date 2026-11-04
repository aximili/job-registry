// What fits in a writing request. Bonsai 2 has a window of 32,768 tokens,
// and a request should leave it about 5,700 to think and answer. So each
// part has a cap, the ad gets what's left, and a request that can't fit at
// all is refused before anything is sent. The fit and the refusal are for an
// AI on this computer: a cloud AI's window is far bigger, so it gets the
// plain caps only. Everything here is plain text in, plain text out.

import {
  AI_PRESETS,
  BRIEF_CAPS,
  BRIEF_LISTS,
  PREP_CAPS,
  PREP_HOURS,
  PREP_LISTS,
  type BriefAnswer,
  type JobNote,
  type PrepAnswer,
  type SavedAi,
  type WriterBrief,
} from '../../../shared/contracts/index.ts';
import { formatDate } from '../../../shared/dates.ts';
import { ValidationError } from '../../core/errors.ts';
import { fillPrompt, type Prompt } from './prompts.ts';
import { AD_CUT, AD_LIMIT, trimAd } from './tasks/parse-job.ts';

// Measured on a real profile: 4.08 characters a token. 4 is a little cautious.
export const CHARS_PER_TOKEN = 4;
export const REQUEST_TOKENS = 27_000;
export const REQUEST_CHARS = REQUEST_TOKENS * CHARS_PER_TOKEN;
// The job's notes, all of them together.
export const NOTES_CAP = 1_200;
export const ANSWER_CAP = BRIEF_CAPS.answer;
// The answers from an earlier brief, all of them together.
export const ANSWERS_CAP = 2_000;
// The brief as the writer gets it, answers included.
export const BRIEF_CAP = 4_500;
// The job's details: role, company and its lists.
export const JOB_CAP = 2_000;
// The least of the ad a local AI gets, however long the rest is.
export const AD_FLOOR = 2_000;
// Over this, a request to a local AI is refused: about 30,000 tokens.
export const HARD_CHARS = 120_000;

// Each part's share of the brief block, so every part keeps a place.
const SHARES = { contact: 200, opening: 450, needs: 1_600, gaps: 750, answers: 1_500 };
// Parts of the block are apart by a blank line, counted in each share.
const PART_GAP = '\n\n';
// Too little room to be worth cutting an entry into.
const MIN_CUT = 40;

const NO_AD = 'No ad saved.';
const NO_NOTES = 'No notes.';
const OLDER_LEFT_OUT = '(Older notes left out.)';
const NO_ANSWERS = 'None yet.';
const NO_BRIEF = 'No brief: plan it yourself, as my guide says.';
// A prep plan has no guide to plan by.
const NO_PREP_BRIEF = 'No brief yet.';

// One line: runs of spaces and line breaks become one space.
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();

// At most max characters, ending "…" when cut.
function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// Entries one a line, while they fit in max. The one that crosses is cut,
// when there's room for some of it. With leftOut, a line saying so ends a
// list where any entry is left out, and its room is kept for it.
function fitEntries(entries: string[], max: number, leftOut = ''): string {
  const all = entries.join('\n');
  if (all.length <= max) return all;
  const room = max - (leftOut ? leftOut.length + 1 : 0);
  const kept: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const gap = kept.length > 0 ? 1 : 0;
    if (used + gap + entry.length <= room) {
      kept.push(entry);
      used += gap + entry.length;
      continue;
    }
    if (room - used - gap >= MIN_CUT) kept.push(cut(entry, room - used - gap));
    break;
  }
  if (leftOut && kept.length < entries.length) kept.push(leftOut);
  return kept.join('\n');
}

// The job's notes, newest first as given, each with its date ("3 Nov 2026: …").
// Every note counts, the email reader's too.
export function notesBlock(notes: JobNote[]): string {
  const entries = notes
    .map((note) => ({ day: formatDate(note.at), text: flat(note.text) }))
    .filter((note) => note.text)
    .map((note) => (note.day ? `${note.day}: ${note.text}` : note.text));
  return entries.length > 0 ? fitEntries(entries, NOTES_CAP, OLDER_LEFT_OUT) : NO_NOTES;
}

const answerLine = (a: { question: string; answer: string }): string =>
  `- ${cut(flat(a.question), BRIEF_CAPS.question)} ${cut(flat(a.answer), ANSWER_CAP)}`;

// Your answers from an earlier brief, so a new one doesn't ask again.
export function answersBlock(answers: { question: string; answer: string }[]): string {
  const entries = answers.filter((a) => flat(a.answer)).map(answerLine);
  return entries.length > 0 ? fitEntries(entries, ANSWERS_CAP) : NO_ANSWERS;
}

// One item of the brief block, given how to fit each of its texts.
type Item = (fit: (text: string) => string) => string;

// A part of the brief block: its heading, then every item. When the part is
// over max, each text is cut to the same length, with "…": the longest
// lose the most, and short ones keep all theirs. So no item is left out.
function part(heading: string, items: Item[], max: number): string {
  const build = (limit: number) =>
    [heading, ...(items.length > 0 ? items : [() => '- None.']).map((item) => item((text) => cut(flat(text), limit)))].join('\n');
  const whole = build(Infinity);
  if (whole.length <= max) return whole;
  // The longest limit that fits.
  let low = 1;
  let high = whole.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (build(mid).length <= max) low = mid;
    else high = mid - 1;
  }
  return build(low);
}

// A line for a text the brief has, or none.
const known = (text: string | null, line: Item): Item[] => (flat(text ?? '') ? [line] : []);

// The brief you checked, as the writer gets it. The cover letter gets all
// of it; the resume and the prep plan leave out who to write to and the
// opening line. Each part keeps to its share.
export function briefBlock(brief: WriterBrief | null, kind: 'resume' | 'cover_letter' | 'prep'): string {
  if (!brief) return kind === 'prep' ? NO_PREP_BRIEF : NO_BRIEF;
  const share = (name: keyof typeof SHARES) => SHARES[name] - PART_GAP.length;
  const parts: string[] = [];
  if (kind === 'cover_letter') {
    const { name, email, recruiter, organisation } = brief.contact;
    const contact: Item[] = [
      (fit) => `- Name: ${fit(name ?? '') || 'not known'}`,
      () => `- From a recruiter: ${recruiter ? 'yes' : 'no'}`,
      ...known(organisation, (fit) => `- Organisation: ${fit(organisation!)}`),
      ...known(email, (fit) => `- Email: ${fit(email!)}`),
    ];
    parts.push(part('Who to write to:', contact, share('contact')));
    const { quote, why } = brief.opening;
    const opening: Item[] = [(fit) => `"${fit(quote)}"`, ...known(why, (fit) => `Why it fits me: ${fit(why)}`)];
    parts.push(part('Opening line, from the ad:', opening, share('opening')));
  }
  const needs = brief.needs.map((n): Item => (fit) => `- ${fit(n.need)}\n  ${fit(n.story.title)}: ${fit(n.story.text)}`);
  parts.push(part('Needs, each with the story to tell:', needs, share('needs')));
  const gaps = brief.gaps.map((g): Item => (fit) => `- ${fit(g.mustHave)}: ${fit(g.evidence)}`);
  parts.push(part("Gaps (must-haves I don't have), with my nearest real evidence:", gaps, share('gaps')));
  const answers = brief.answers.filter((a) => flat(a.answer)).map((a): Item => (fit) => `- ${fit(a.question)} ${fit(a.answer)}`);
  parts.push(part('My answers to your questions:', answers, share('answers')));
  return parts.join(PART_GAP);
}

// A local AI can't take it: refused where you write, before anything is
// sent. A ValidationError, so the pill never shows it.
export function checkSize(chars: number, local: boolean, name: string): void {
  if (!local || chars <= HARD_CHARS) return;
  // Rounded up, so it never reads as within the limit.
  const about = (Math.ceil(chars / 1_000) * 1_000).toLocaleString('en-AU');
  const fits = REQUEST_CHARS.toLocaleString('en-AU');
  throw new ValidationError(
    `This is too long for ${name}: about ${about} characters, and it fits about ${fits}. Shorten your master profile or your guide, or pick a cloud AI to write (Settings → AI).`,
  );
}

export function capJob(job: string): string {
  return cut(job.trim(), JOB_CAP);
}

// The ad, cut to fit. On a local AI it gets what's left of the request after
// everything else, up to its usual 12,000 and never less than 2,000. A cut ad
// ends with the cut line, on top. A job with no ad text says so.
export function fitAd(ad: string, otherChars: number, local: boolean): string {
  if (!ad.trim()) return NO_AD;
  if (!local) return trimAd(ad);
  return trimAd(ad, Math.min(AD_LIMIT, Math.max(AD_FLOOR, REQUEST_CHARS - otherChars)));
}

// A writing request's system and user parts, with the ad last, fitted to the
// AI it goes to. The user part's {{ad}} is filled last. Refused when it
// can't fit a local AI.
export function fitRequest(
  prompt: Prompt,
  values: Record<string, string>,
  ad: string,
  ai: Pick<SavedAi, 'name' | 'preset'>,
): { system: string; user: string } {
  const local = AI_PRESETS[ai.preset].group === 'local';
  const system = fillPrompt(prompt.system, values);
  // Room for the cut line too, so a cut ad still fits.
  const other = system.length + fillPrompt(prompt.user, { ...values, ad: '' }).length + AD_CUT.length;
  const user = fillPrompt(prompt.user, { ...values, ad: fitAd(ad, other, local) });
  checkSize(system.length + user.length, local, ai.name);
  return { system, user };
}

// Anything that looks like a link: the prompt asks for none, and this makes sure.
const LINK = /(?:https?:\/\/|www\.)[^\s<>()"']*[^\s<>()"'.,;:!?]/gi;
const unlinked = (value: string): string =>
  value
    .replace(LINK, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();

// The text without its links, for the brief: text with none stays as it is.
const noLinks = (value: string): string => (value.search(LINK) === -1 ? value : unlinked(value));

// The brief as the AI made it, cut to its caps and without its links, with
// whether its quote is in the ad.
export type CutBrief = BriefAnswer & { opening: { inAd: boolean } };

const text = (value: string, max: number): string => cut(noLinks(value).trim(), max);
const orNull = (value: string | null, max: number): string | null => (value && noLinks(value).trim() ? text(value, max) : null);
const story = (s: { title: string; text: string }) => ({ title: text(s.title, BRIEF_CAPS.storyTitle), text: text(s.text, BRIEF_CAPS.storyText) });

// For the quote check: case, spaces and the kind of quote mark or dash don't count.
const plain = (value: string): string =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, '');

export function cutBrief(answer: BriefAnswer, ad: string): CutBrief {
  // A quote in quote marks is the line inside them.
  const quote = noLinks(answer.opening.quote).trim().replace(/^["“”](.*)["“”]$/s, '$1').trim();
  const { contact } = answer;
  return {
    contact: {
      name: orNull(contact.name, BRIEF_CAPS.name),
      email: orNull(contact.email, BRIEF_CAPS.email),
      recruiter: contact.recruiter,
      organisation: orNull(contact.organisation, BRIEF_CAPS.organisation),
    },
    needs: answer.needs.slice(0, BRIEF_LISTS.needs).map((n) => ({
      need: text(n.need, BRIEF_CAPS.need),
      story: story(n.story),
      others: n.others.slice(0, BRIEF_LISTS.others).map(story),
    })),
    opening: {
      quote: text(quote, BRIEF_CAPS.quote),
      why: text(answer.opening.why, BRIEF_CAPS.quoteWhy),
      // A quote cut to its cap isn't word for word any more: check it.
      inAd: quote.length <= BRIEF_CAPS.quote && plain(quote) !== '' && plain(ad).includes(plain(quote)),
    },
    gaps: answer.gaps
      .slice(0, BRIEF_LISTS.gaps)
      .map((g) => ({ mustHave: text(g.mustHave, BRIEF_CAPS.mustHave), evidence: text(g.evidence, BRIEF_CAPS.evidence) })),
    questions: answer.questions
      .slice(0, BRIEF_LISTS.questions)
      .map((q) => ({ question: text(q.question, BRIEF_CAPS.question), why: text(q.why, BRIEF_CAPS.questionWhy) })),
  };
}

const prepText = (value: string, max: number = PREP_CAPS.text): string => cut(unlinked(value), max);
const items = (list: string[], max: number): string[] => list.map((item) => prepText(item, max)).filter(Boolean);
const hours = (value: number): number => Math.min(PREP_HOURS.max, Math.max(PREP_HOURS.min, value));

export function cutPrep(answer: PrepAnswer): PrepAnswer {
  const { project } = answer;
  return {
    learn: answer.learn.slice(0, PREP_LISTS.learn).map((l) => ({
      topic: prepText(l.topic),
      why: prepText(l.why),
      // A step that was only a link is gone; the topic keeps the rest, even one.
      steps: items(l.steps, PREP_CAPS.step).slice(0, PREP_LISTS.steps),
      hours: hours(l.hours),
      afterwards: prepText(l.afterwards),
    })),
    project: {
      title: prepText(project.title),
      what: prepText(project.what),
      touches: items(project.touches, PREP_CAPS.text).slice(0, PREP_LISTS.touches),
      hours: hours(project.hours),
      afterwards: prepText(project.afterwards),
    },
    interview: answer.interview.slice(0, PREP_LISTS.interview).map((q) => ({ question: prepText(q.question), story: prepText(q.story) })),
    ask: answer.ask.slice(0, PREP_LISTS.ask).map((q) => ({ question: prepText(q.question), why: prepText(q.why) })),
    refresh: answer.refresh.slice(0, PREP_LISTS.refresh).map((r) => ({ item: prepText(r.item), why: prepText(r.why) })),
  };
}
