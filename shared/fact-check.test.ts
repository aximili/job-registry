import { describe, expect, it } from 'vitest';
import { createFactChecker, factCheck } from './fact-check.ts';

const PROFILE = `# Sam Taylor
0412 345 678 · sam@example.com

## Experience
### Senior Engineer, Example Co (2019-2021)
- Cut build times by 30%.
- Managed a $150,000 budget.
- Moved the web app to TypeScript.

## Certifications
AWS Certified Developer
`;

const texts = (draft: string, allow?: string[]) => factCheck(draft, PROFILE, allow).map((f) => f.text);

describe('factCheck: what it flags', () => {
  it('flags an invented percentage', () => {
    expect(factCheck('- Grew revenue 40% in a year.', PROFILE)).toEqual([{ text: '40%', kind: 'percent' }]);
  });

  it('flags an employer that is not in the profile', () => {
    expect(texts('I worked at Globex for two years.')).toEqual(['Globex', 'two']);
  });

  it('flags a whole certification at the start of a bullet', () => {
    expect(factCheck('- AWS Certified Solutions Architect', PROFILE)).toEqual([
      { text: 'AWS Certified Solutions Architect', kind: 'name' },
    ]);
  });

  it('flags invented money and date ranges', () => {
    expect(factCheck('Ran a $200k budget from 2016–2018.', PROFILE)).toEqual([
      { text: '$200k', kind: 'money' },
      { text: '2016–2018', kind: 'range' },
    ]);
  });

  it('flags a small number that only appears inside a longer one in the profile', () => {
    const profile = 'I started in 2015.';
    expect(factCheck('I have 5 years of experience.', profile)).toEqual([{ text: '5', kind: 'number' }]);
  });

  it('flags the same invented name once', () => {
    expect(texts('I joined Globex. I left Globex.')).toEqual(['Globex']);
  });
});

describe('factCheck: what it leaves alone', () => {
  it('accepts profile facts written differently', () => {
    expect(texts('- Cut build times by 30 %.\n- At Example Co from 2019–2021.\n- A $150,000 budget.')).toEqual([]);
    expect(texts('Call me on 0412345678 or +61 412 345 678.')).toEqual([]);
    expect(texts('I moved the app to typescript.')).toEqual([]);
    expect(texts("I loved Example Co's platform work.")).toEqual([]);
  });

  it('ignores headings and the capital at the start of a sentence', () => {
    expect(texts('## Professional Summary\n\nLed the TypeScript move.\n\n## Work History')).toEqual([]);
    expect(texts('Senior Engineer with a love of tests.')).toEqual([]);
  });

  it('accepts the job title, company and agency from the ad', () => {
    expect(texts("Dear Hiring Manager,\n\nI'd love to join Atlassian as a Senior Platform Engineer.", ['Atlassian', 'Senior Platform Engineer'])).toEqual(
      [],
    );
  });

  it('ignores month and day names, states, and Markdown list numbers', () => {
    expect(texts('1. Based in Sydney NSW since March.\n2. Available on Monday.')).toEqual(['Sydney']);
  });

  it("ignores a letter's full date", () => {
    expect(texts('28 October 2026\n\nDear Hiring Manager,')).toEqual([]);
  });

  it('ignores link targets', () => {
    expect(texts('See [my site](https://Globex.example/2024).')).toEqual([]);
  });
});

describe('createFactChecker', () => {
  it('reads the profile once and checks many drafts', () => {
    const check = createFactChecker(PROFILE, ['Atlassian']);
    expect(check('Atlassian and Globex')).toEqual([{ text: 'Globex', kind: 'name' }]);
    expect(check('Up 30%')).toEqual([]);
  });
});

describe('factCheck: review fixes', () => {
  const PROFILE2 = `# Jo Citizen
## Education
Bachelor of Commerce (Finance), UNSW
## Experience
### Senior Data Analyst, Procter & Gamble (2018-2022)
Certified Scrum Master (CSM)
`;

  it('accepts names copied straight from the profile, brackets and & included', () => {
    expect(factCheck('Bachelor of Commerce (Finance), UNSW', PROFILE2)).toEqual([]);
    expect(factCheck('I was an analyst at Procter & Gamble.', PROFILE2)).toEqual([]);
    expect(factCheck('I am a Certified Scrum Master (CSM).', PROFILE2)).toEqual([]);
  });

  it('every flag is text that appears in the draft, so the preview can highlight it', () => {
    const draft = 'I am a Certified Kanban Coach (CKC) at Initech & Partners (Sydney).';
    const flags = factCheck(draft, PROFILE2);
    expect(flags.map((f) => f.text)).toEqual(['Certified Kanban Coach', 'CKC', 'Initech & Partners', 'Sydney']);
    for (const f of flags) expect(draft).toContain(f.text);
  });

  it('flags an inflated job title on a heading or at the start of a line', () => {
    expect(texts('### Principal Engineer, Example Co (2019–2021)')).toEqual(['Principal Engineer']);
    expect(texts('### Engineering Manager, Example Co')).toEqual(['Engineering Manager']);
    expect(texts('- Lead Data Analyst at Example Co')).toEqual(['Lead Data Analyst']);
    expect(texts('### Senior Engineer, Example Co (2019–2021)')).toEqual([]);
  });

  it('still never flags the hiring manager or team a letter is addressed to', () => {
    expect(texts('Dear Hiring Manager,')).toEqual([]);
    expect(texts('Dear Hiring Team,')).toEqual([]);
  });

  it('accepts a date range written another way: short months, present or current, years alone', () => {
    const profile = 'March 2020 – present. January 2017 – February 2020. Jan 2015 – Dec 2016. 2012 – current.';
    expect(factCheck('Mar 2020 – Present', profile)).toEqual([]);
    expect(factCheck('Jan 2017 – Feb 2020', profile)).toEqual([]);
    expect(factCheck('2015–2016', profile)).toEqual([]);
    expect(factCheck('2012 – Present', profile)).toEqual([]);
  });

  it('flags a date range whose years or months differ from the profile', () => {
    const profile = 'March 2020 – present.';
    expect(factCheck('Mar 2019 – Present', profile)).toEqual([{ text: 'Mar 2019 – Present', kind: 'range' }]);
    expect(factCheck('Apr 2020 – Present', profile)).toEqual([{ text: 'Apr 2020 – Present', kind: 'range' }]);
  });
});

describe('factCheck: final review fixes', () => {
  const BARE = '# Sam Taylor\nSenior engineer for eight years. I managed teams and led projects.';

  it('flags a one-word name that starts a line, a label or a list', () => {
    expect(factCheck('**Telstra** | Sydney | 2016 – 2018', BARE).map((f) => f.text)).toEqual(['Telstra', 'Sydney', '2016 – 2018']);
    expect(factCheck('- Deloitte: advised clients on cloud.', BARE).map((f) => f.text)).toEqual(['Deloitte']);
    expect(factCheck('- Kubernetes', BARE).map((f) => f.text)).toEqual(['Kubernetes']);
    expect(factCheck('- Python, Go and Rust', BARE).map((f) => f.text)).toEqual(['Python', 'Go', 'Rust']);
    expect(factCheck('Globex hired me in a week.', BARE).map((f) => f.text)).toEqual(['Globex']);
  });

  it('still drops a verb or small word that just starts a sentence', () => {
    expect(factCheck('Managed a team. Led the work. The team grew. Currently I write code.', BARE)).toEqual([]);
  });

  it('checks numbers written as words', () => {
    expect(factCheck('A senior engineer with ten years of experience.', BARE)).toEqual([{ text: 'ten', kind: 'number' }]);
    expect(factCheck('A senior engineer with eight years of experience.', BARE)).toEqual([]);
  });

  it('never flags the usual Australian resume headings', () => {
    const headings = '## Referees\nReferees available on request.\n## Professional Development\n## Additional Information\n### Languages & Frameworks\n## Leadership';
    expect(factCheck(headings, BARE)).toEqual([]);
  });
});
