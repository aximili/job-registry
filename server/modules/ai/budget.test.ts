import { describe, expect, it } from 'vitest';
import { BRIEF_QUESTIONS_KEPT, type BriefAnswer, type PrepAnswer, type WriterBrief } from '../../../shared/contracts/index.ts';
import { ValidationError } from '../../core/errors.ts';
import {
  AD_FLOOR,
  ANSWER_CAP,
  ANSWERS_CAP,
  answersBlock,
  BRIEF_CAP,
  briefBlock,
  capJob,
  CHARS_PER_TOKEN,
  checkSize,
  cutBrief,
  cutPrep,
  fitAd,
  HARD_CHARS,
  JOB_CAP,
  NOTES_CAP,
  notesBlock,
  REQUEST_CHARS,
  REQUEST_TOKENS,
} from './budget.ts';
import { AD_LIMIT } from './tasks/parse-job.ts';

const CUT = '\n[The rest of the ad was cut.]';
// Midday UTC is 3 Nov on every computer from UTC−11 to UTC+11.
const AT = '2026-11-03T12:00:00.000Z';
const AT_BEFORE = '2026-11-01T12:00:00.000Z';

// Made-up text of exactly n characters, with a mark to find it by.
const text = (n: number, mark = 'x') => `${`${mark} `.repeat(n).slice(0, n - 1)}.`;

// A brief with every field at its cap.
const FULL: WriterBrief = {
  contact: { name: text(120, 'Alex'), email: text(120, 'alex@example-recruit.com.au'), recruiter: true, organisation: text(120, 'Example Recruit') },
  opening: { quote: text(300, 'quote'), why: text(240, 'why') },
  needs: [1, 2, 3].map((n) => ({ need: text(160, `need${n}`), story: { title: text(80, `title${n}`), text: text(320, `story${n}`) } })),
  gaps: [1, 2, 3, 4, 5].map((n) => ({ mustHave: text(160, `gap${n}`), evidence: text(240, `evidence${n}`) })),
  answers: [1, 2, 3, 4, 5].map((n) => ({ question: text(160, `question${n}`), answer: text(240, `answer${n}`) })),
};

// The block's parts, by the first word of each heading.
function parts(block: string): Record<string, string> {
  return Object.fromEntries(block.split('\n\n').map((part) => [part.split(/[\s,:]/)[0]!, part]));
}

describe('the budget', () => {
  it('counts 4 characters a token, so a request may hold 108,000 characters', () => {
    expect(CHARS_PER_TOKEN).toBe(4);
    expect(REQUEST_TOKENS).toBe(27_000);
    expect(REQUEST_CHARS).toBe(108_000);
    expect(HARD_CHARS).toBe(120_000);
    expect({ NOTES_CAP, ANSWER_CAP, ANSWERS_CAP, BRIEF_CAP, JOB_CAP, AD_FLOOR, AD_LIMIT }).toEqual({
      NOTES_CAP: 1_200,
      ANSWER_CAP: 240,
      ANSWERS_CAP: 2_000,
      BRIEF_CAP: 4_500,
      JOB_CAP: 2_000,
      AD_FLOOR: 2_000,
      AD_LIMIT: 12_000,
    });
  });
});

describe('notesBlock', () => {
  it('says "No notes." when there are none', () => {
    expect(notesBlock([])).toBe('No notes.');
    expect(notesBlock([{ at: AT, text: '  \n ' }])).toBe('No notes.');
  });

  it('gives each note its date, newest first as given, one note a line', () => {
    const block = notesBlock([
      { at: AT, text: 'Email, 3 Nov 2026 (interview) from Alex: an interview on Friday.' },
      { at: AT_BEFORE, text: 'Called Alex.\nThey want someone who mentors.' },
    ]);
    expect(block).toBe('3 Nov 2026: Email, 3 Nov 2026 (interview) from Alex: an interview on Friday.\n1 Nov 2026: Called Alex. They want someone who mentors.');
  });

  it('keeps whole notes until 1,200 characters, cuts the one that crosses with "…", and leaves out the older ones', () => {
    const notes = [1, 2, 3, 4, 5].map((n) => ({ at: AT, text: text(400, `note${n}`) }));
    const block = notesBlock(notes);
    expect(block.length).toBeLessThanOrEqual(NOTES_CAP);
    const lines = block.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(`3 Nov 2026: ${notes[0]!.text}`);
    expect(lines[1]).toBe(`3 Nov 2026: ${notes[1]!.text}`);
    expect(lines[2]!.startsWith(`3 Nov 2026: ${notes[2]!.text.slice(0, 100)}`)).toBe(true);
    expect(lines[2]!.endsWith('…')).toBe(true);
    expect(lines[3]).toBe('(Older notes left out.)');
    expect(block).not.toContain('note4');
  });

  it('one long note is cut to the cap, with nothing left out to say', () => {
    const block = notesBlock([{ at: AT, text: text(3_000, 'long') }]);
    expect(block.length).toBeLessThanOrEqual(NOTES_CAP);
    expect(block.endsWith('…')).toBe(true);
    expect(block).not.toContain('Older notes');
  });
});

describe('answersBlock', () => {
  it('says so when there are none', () => {
    expect(answersBlock([])).toBe('None yet.');
  });

  it('gives each question with its answer, one a line', () => {
    expect(answersBlock([{ question: 'Have you used Go?', answer: 'Yes, in a side project.\nFor a year.' }])).toBe(
      '- Have you used Go? Yes, in a side project. For a year.',
    );
  });

  it('stays within 2,000 characters with five answers at 240, and cuts a longer answer to 240', () => {
    const answers = [1, 2, 3, 4, 5].map((n) => ({ question: text(160, `question${n}`), answer: text(240, `answer${n}`) }));
    const block = answersBlock(answers);
    expect(block.length).toBeLessThanOrEqual(ANSWERS_CAP);
    expect(block).toContain('question4');
    expect(answersBlock([{ question: 'Q?', answer: text(500) }])).toBe(`- Q? ${text(500).slice(0, 239)}…`);
  });
});

describe('briefBlock', () => {
  it('says to plan it yourself when there is no brief, or, for a prep plan, that there is none yet', () => {
    expect(briefBlock(null, 'resume')).toBe('No brief: plan it yourself, as my guide says.');
    expect(briefBlock(null, 'cover_letter')).toBe('No brief: plan it yourself, as my guide says.');
    expect(briefBlock(null, 'prep')).toBe('No brief yet.');
  });

  it('a cover letter gets every part, the whole block within 4,500 characters and each part within its share', () => {
    const block = briefBlock(FULL, 'cover_letter');
    expect(block.length).toBeLessThanOrEqual(BRIEF_CAP);
    const p = parts(block);
    expect(Object.keys(p)).toEqual(['Who', 'Opening', 'Needs', 'Gaps', 'My']);
    expect(p.Who!.length).toBeLessThanOrEqual(200);
    expect(p.Opening!.length).toBeLessThanOrEqual(450);
    expect(p.Needs!.length).toBeLessThanOrEqual(1_600);
    expect(p.Gaps!.length).toBeLessThanOrEqual(750);
    expect(p.My!.length).toBeLessThanOrEqual(1_500);
  });

  it('keeps every item, with every field at its cap: a part over its share cuts each text evenly, with "…"', () => {
    const block = briefBlock(FULL, 'cover_letter');
    const p = parts(block);
    for (const mark of ['Alex', 'alex@example-recruit.com.au', 'Example Recruit', '- From a recruiter: yes']) expect(p.Who).toContain(mark);
    expect(p.Opening).toContain('"quote quote');
    expect(p.Opening).toContain('Why it fits me: why why');
    for (const n of [1, 2, 3]) for (const mark of [`need${n}`, `title${n}`, `story${n}`]) expect(p.Needs).toContain(mark);
    for (const n of [1, 2, 3, 4, 5]) {
      for (const mark of [`gap${n}`, `evidence${n}`]) expect(p.Gaps).toContain(mark);
      for (const mark of [`question${n}`, `answer${n}`]) expect(p.My).toContain(mark);
    }
    // The longest texts lose the most: each need and its title stay whole, and the three stories are cut alike.
    const stories = p.Needs!.split('\n').filter((line) => line.startsWith('  '));
    expect(stories).toHaveLength(3);
    for (const [i, line] of stories.entries()) {
      expect(p.Needs).toContain(FULL.needs[i]!.need);
      expect(line.startsWith(`  ${FULL.needs[i]!.story.title}: `)).toBe(true);
      expect(line.endsWith('…')).toBe(true);
      expect(line.length).toBe(stories[0]!.length);
    }
  });

  it('keeps a brief with 10 answers at their caps within its share, every answer still there', () => {
    const answers = Array.from({ length: BRIEF_QUESTIONS_KEPT }, (_, i) => ({ question: text(160, `q${i + 1}x`), answer: text(240, `a${i + 1}x`) }));
    const block = briefBlock({ ...FULL, answers }, 'cover_letter');
    expect(block.length).toBeLessThanOrEqual(BRIEF_CAP);
    const mine = parts(block).My!;
    expect(mine.length).toBeLessThanOrEqual(1_500);
    for (let n = 1; n <= BRIEF_QUESTIONS_KEPT; n++) for (const mark of [`q${n}x`, `a${n}x`]) expect(mine).toContain(mark);
  });

  it('a short text keeps all of it while the long ones around it are cut', () => {
    const brief = { ...FULL, gaps: [{ mustHave: 'Go', evidence: 'A side project.' }, ...FULL.gaps.slice(1)] };
    const gaps = parts(briefBlock(brief, 'resume')).Gaps!.split('\n');
    expect(gaps[1]).toBe('- Go: A side project.');
    expect(gaps[2]!.endsWith('…')).toBe(true);
  });

  it('a resume and a prep plan leave out the contact and the opening line', () => {
    for (const kind of ['resume', 'prep'] as const) {
      const block = briefBlock(FULL, kind);
      expect(Object.keys(parts(block))).toEqual(['Needs', 'Gaps', 'My']);
      expect(block).not.toContain('Alex');
      expect(block).not.toContain('quote');
      expect(block.length).toBeLessThanOrEqual(1_600 + 750 + 1_500);
      for (const n of [1, 2, 3]) expect(block).toContain(`story${n}`);
    }
  });

  it('gives only the needs the brief keeps, and says when a part is empty', () => {
    const brief: WriterBrief = {
      contact: { name: null, email: null, recruiter: false, organisation: null },
      opening: { quote: 'We build tools for builders.', why: 'I build tools for engineers.' },
      needs: [{ need: 'TypeScript', story: { title: 'The move', text: 'I moved the web app to TypeScript.' } }],
      gaps: [],
      answers: [],
    };
    expect(briefBlock(brief, 'cover_letter')).toBe(
      [
        'Who to write to:',
        '- Name: not known',
        '- From a recruiter: no',
        '',
        'Opening line, from the ad:',
        '"We build tools for builders."',
        'Why it fits me: I build tools for engineers.',
        '',
        'Needs, each with the story to tell:',
        '- TypeScript',
        '  The move: I moved the web app to TypeScript.',
        '',
        "Gaps (must-haves I don't have), with my nearest real evidence:",
        '- None.',
        '',
        'My answers to your questions:',
        '- None.',
      ].join('\n'),
    );
  });
});

describe('checkSize', () => {
  const TOO_LONG =
    'This is too long for Bonsai 2: about 122,000 characters, and it fits about 108,000. Shorten your master profile or your guide, or pick a cloud AI to write (Settings → AI).';

  it('refuses a request over 120,000 characters on a local AI, as a ValidationError with the sentence', () => {
    const err = (() => {
      try {
        checkSize(121_234, true, 'Bonsai 2');
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toBe(TOO_LONG);
  });

  it('rounds the size up, so a refused request never reads as one that fits', () => {
    expect(() => checkSize(120_001, true, 'Bonsai 2')).toThrow('This is too long for Bonsai 2: about 121,000 characters,');
  });

  it('lets 120,000 through on a local AI, and anything on a cloud AI', () => {
    expect(() => checkSize(HARD_CHARS, true, 'Bonsai 2')).not.toThrow();
    expect(() => checkSize(500_000, false, 'Claude – mine')).not.toThrow();
  });
});

describe('capJob and fitAd', () => {
  it("cuts the job's details to 2,000 characters", () => {
    expect(capJob(text(3_000)).length).toBeLessThanOrEqual(JOB_CAP);
    expect(capJob('  Role: Engineer \n')).toBe('Role: Engineer');
  });

  const ad = text(20_000, 'ad');

  it("on a local AI, the ad gets what's left of 108,000 characters, never less than 2,000", () => {
    expect(fitAd(ad, 100_000, true)).toBe(ad.slice(0, 8_000) + CUT);
    expect(fitAd(ad, 107_000, true)).toBe(ad.slice(0, 2_000) + CUT);
    expect(fitAd(ad, 50_000, true)).toBe(ad.slice(0, 12_000) + CUT);
    expect(fitAd('A short ad.', 107_000, true)).toBe('A short ad.');
  });

  it('on a cloud AI, the ad gets its 12,000 characters, whatever else there is', () => {
    expect(fitAd(ad, 107_000, false)).toBe(ad.slice(0, 12_000) + CUT);
  });

  it('a job with no ad text says so, on any AI', () => {
    for (const local of [true, false]) {
      expect(fitAd('', 1_000, local)).toBe('No ad saved.');
      expect(fitAd(' \n ', 1_000, local)).toBe('No ad saved.');
    }
  });
});

describe('cutBrief', () => {
  const story = (n: number) => ({ title: `Story ${n}`, text: `What I did, ${n}.` });
  const answer: BriefAnswer = {
    contact: { name: '  Alex  ', email: '  ', recruiter: true, organisation: text(200, 'Example Recruit') },
    needs: [1, 2, 3, 4].map((n) => ({ need: `Need ${n}`, story: story(n), others: [story(10), story(11), story(12)] })),
    opening: { quote: '  We  BUILD tools\nfor builders. ', why: 'I build tools for engineers.' },
    gaps: [1, 2, 3, 4, 5, 6].map((n) => ({ mustHave: `Gap ${n}`, evidence: 'Some self-study.' })),
    questions: [1, 2, 3, 4, 5, 6].map((n) => ({ question: `Question ${n}?`, why: 'It changes the letter.' })),
  };
  const AD = 'Example Co\n\nWe build tools for builders.\nYou know TypeScript.';

  it('cuts every list to its size', () => {
    const cut = cutBrief(answer, AD);
    expect(cut.needs.map((n) => n.need)).toEqual(['Need 1', 'Need 2', 'Need 3']);
    expect(cut.needs[0]!.others).toHaveLength(2);
    expect(cut.gaps).toHaveLength(5);
    expect(cut.questions).toHaveLength(5);
  });

  it('cuts text to its cap, and a blank contact field is null', () => {
    const long = { ...answer, needs: [{ need: text(200), story: { title: text(100), text: text(500) }, others: [] }] };
    const cut = cutBrief(long, AD);
    expect(cut.needs[0]!.story.text).toHaveLength(320);
    expect(cut.needs[0]!.story.text.endsWith('…')).toBe(true);
    expect(cut.needs[0]!.story.title).toHaveLength(80);
    expect(cut.needs[0]!.need).toHaveLength(160);
    expect(cut.contact).toEqual({ name: 'Alex', email: null, recruiter: true, organisation: expect.any(String) });
    expect(cut.contact.organisation).toHaveLength(120);
  });

  it('says whether the quote is in the ad, with spaces and case ignored', () => {
    expect(cutBrief(answer, AD).opening).toEqual({ quote: 'We  BUILD tools\nfor builders.', why: 'I build tools for engineers.', inAd: true });
    expect(cutBrief({ ...answer, opening: { quote: '“We build tools for builders.”', why: '' } }, AD).opening).toMatchObject({
      quote: 'We build tools for builders.',
      inAd: true,
    });
    expect(cutBrief({ ...answer, opening: { quote: 'We build the best tools.', why: '' } }, AD).opening.inAd).toBe(false);
    expect(cutBrief({ ...answer, opening: { quote: '  ', why: '' } }, AD).opening.inAd).toBe(false);
  });

  it('removes every link from the text, as for a prep plan', () => {
    const linked: BriefAnswer = {
      contact: { name: 'Alex', email: 'alex@example-recruit.com.au', recruiter: true, organisation: 'www.example-recruit.com.au' },
      needs: [
        {
          need: 'TypeScript (https://example.com/stack)',
          story: { title: 'The move', text: 'I moved the app (www.example.com/app).' },
          others: [{ title: 'http://example.com', text: 'Builds.' }],
        },
      ],
      opening: { quote: 'Apply at https://example.com/jobs today.', why: 'I fit. www.example.com' },
      gaps: [{ mustHave: 'Go', evidence: 'A course at https://example.com/go.' }],
      questions: [{ question: 'Have you seen www.example.com/team?', why: 'It changes the letter.' }],
    };
    const cut = cutBrief(linked, 'Apply at https://example.com/jobs today.');
    expect(JSON.stringify(cut)).not.toMatch(/https?:|www\./);
    // A field that was only a link is none.
    expect(cut.contact).toEqual({ name: 'Alex', email: 'alex@example-recruit.com.au', recruiter: true, organisation: null });
    expect(cut.needs[0]).toEqual({ need: 'TypeScript', story: { title: 'The move', text: 'I moved the app.' }, others: [{ title: '', text: 'Builds.' }] });
    // Without its link, the quote isn't word for word any more.
    expect(cut.opening).toEqual({ quote: 'Apply at today.', why: 'I fit.', inAd: false });
    expect(cut.gaps[0]!.evidence).toBe('A course at.');
    expect(cut.questions[0]!.question).toBe('Have you seen?');
  });

  it('a quote cut to its cap is no longer word for word, so it says to check it', () => {
    const line = text(400, 'telling');
    const cut = cutBrief({ ...answer, opening: { quote: line, why: 'It fits.' } }, `Example Co\n${line}`).opening;
    expect(cut.quote).toHaveLength(300);
    expect(cut.inAd).toBe(false);
  });
});

describe('cutPrep', () => {
  const plan: PrepAnswer = {
    learn: [1, 2, 3, 4, 5, 6].map((n) => ({
      topic: `Topic ${n}`,
      why: 'The ad asks for it.',
      steps: ['Do the course at https://example.com/course today.', 'Read www.example.com and take notes.', 'Build one.', 'Test it.', 'Ship it.'],
      hours: 2,
      afterwards: 'I can say I have tried it.',
    })),
    project: { title: 'A tool', what: text(400), touches: ['Go', 'http://example.com'], hours: 6, afterwards: 'I built one.' },
    interview: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ question: `Question ${n}?`, story: 'The build-time story.' })),
    ask: [1, 2, 3, 4, 5, 6].map((n) => ({ question: `Ask ${n}?`, why: 'The ad leaves it open.' })),
    refresh: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ item: `Item ${n}`, why: 'They may ask.' })),
  };

  it('removes every link from the text', () => {
    const cut = cutPrep(plan);
    expect(cut.learn[0]!.steps.slice(0, 2)).toEqual(['Do the course at today.', 'Read and take notes.']);
    expect(JSON.stringify(cut)).not.toMatch(/https?:|www\./);
    // A list item that was only a link is gone.
    expect(cut.project.touches).toEqual(['Go']);
  });

  it('drops a step that was only a link, and keeps what is left, even one step', () => {
    const steps = ['https://example.com/course', 'www.example.com', 'Build a small tool in Go.'];
    expect(cutPrep({ ...plan, learn: [{ ...plan.learn[0]!, steps }] }).learn[0]!.steps).toEqual(['Build a small tool in Go.']);
  });

  it('cuts every list to its size and the text to its cap', () => {
    const cut = cutPrep(plan);
    expect(cut.learn).toHaveLength(5);
    expect(cut.learn[0]!.steps).toHaveLength(4);
    expect(cut.interview).toHaveLength(6);
    expect(cut.ask).toHaveLength(5);
    expect(cut.refresh).toHaveLength(8);
    expect(cut.project.what).toHaveLength(320);
    const touches = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Area ${n}`);
    expect(cutPrep({ ...plan, project: { ...plan.project, touches } }).project.touches).toEqual(touches.slice(0, 6));
    expect(cutPrep({ ...plan, learn: [{ ...plan.learn[0]!, steps: [text(300), 'Two.'] }] }).learn[0]!.steps[0]).toHaveLength(200);
  });
});
