// A fake AI for the browser tests that actually reads the pasted ad a little,
// so a test can paste an ad and see its own details come back:
//   line 1 → role, line 2 → company, the first "$…" amount or range → salary,
//   lines starting with "- " or "• " → requirements.
// A brief quotes the ad's first long line, so its quote is in the ad.
// Modes: "smart" (the default), "fail" (the AI can't be reached), "slow",
// and "bad" (an answer that never fits).

import type { BriefAnswer, EmailClassification, EmailEvent, ParsedJob } from '../../shared/contracts/index.ts';
import { AiUnavailableError } from '../../server/core/errors.ts';
import { FAKE_BRIEF, FAKE_CARD_RATING, FAKE_PREP, FAKE_RATING, FakeAiProvider } from './fake-ai-provider.ts';

// The quick rating the fake gives every job card in a search list, and its
// prep plan. They live with the plain fake, which gives the same answers.
export { FAKE_CARD_RATING, FAKE_PREP };

export type SmartMode = 'smart' | 'fail' | 'slow' | 'bad';

// The browser tests' master profile.
export const E2E_PROFILE = [
  '# Sam Taylor',
  'sam@example.com · 0412 345 678',
  '',
  'Senior engineer. Eight years of TypeScript.',
  '',
  '## Experience',
  '### Senior Engineer, Example Co (2019–2024)',
  '- Cut build times by 30%.',
  '- Moved the web app to TypeScript.',
  '',
].join('\n');

// What the fake writes when asked for a document. Every fact in it is in the
// browser tests' master profile (tests/e2e/serve.ts), so the fact-check
// flags nothing.
export const FAKE_RESUME = [
  '# Sam Taylor',
  '',
  'sam@example.com · 0412 345 678',
  '',
  '## Summary',
  '',
  'Senior engineer with eight years of TypeScript.',
  '',
  '## Experience',
  '',
  '### Senior Engineer, Example Co (2019–2024)',
  '',
  '- Cut build times by 30%.',
  '- Moved the web app to TypeScript.',
].join('\n');

export const FAKE_COVER_LETTER = ['Dear Hiring Manager,', '', 'I would like to apply. I have eight years of TypeScript.', '', 'Kind regards,', 'Sam Taylor'].join(
  '\n',
);

export const FAIL_MESSAGE = "Can't reach the AI at http://127.0.0.1:8080/v1. Check that it's running, or pick another AI in Settings.";

export function readAdLikeAPerson(ad: string): ParsedJob {
  const lines = ad
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const money = ad.match(/\$\s?([\d,]+)(?:\s*[-–]\s*\$?\s?([\d,]+))?/);
  const num = (s: string | undefined) => (s ? Number(s.replace(/,/g, '')) : null);
  const min = num(money?.[1]);
  const max = num(money?.[2]) ?? min;
  return {
    title: lines[0] ?? null,
    company: lines[1] ?? null,
    agency: null,
    location: null,
    workMode: 'unknown',
    employmentType: 'unknown',
    salary: money
      ? { min, max, currency: 'AUD', period: 'year', text: money[0] }
      : { min: null, max: null, currency: null, period: null, text: null },
    closingDate: null,
    summary: lines[2] ?? '',
    requirements: lines.filter((l) => /^[-•]\s/.test(l)).map((l) => l.replace(/^[-•]\s+/, '')),
    niceToHave: [],
    responsibilities: [],
    adContact: null,
  };
}

// Reads an email the way a person skims it: a word or two decides the event,
// and the first candidate job is the one it's about.
export function readEmailLikeAPerson(system: string, user: string): EmailClassification {
  const email = user.toLowerCase();
  const event: EmailEvent = /unfortunately|not progress|unsuccessful/.test(email)
    ? 'rejected'
    : /interview/.test(email)
      ? 'interview'
      : /offer/.test(email)
        ? 'offer'
        : /assessment|challenge/.test(email)
          ? 'assessment'
          : /thank you for applying|thanks for applying|received your application/.test(email)
            ? 'received'
            : 'other';
  const first = /^\[(\d+)\]/m.exec(system);
  const subject = /^Subject: (.*)$/m.exec(user)?.[1] ?? '';
  return {
    event,
    jobId: first ? Number(first[1]) : null,
    company: null,
    role: null,
    confidence: event === 'other' ? 0.3 : 0.9,
    summary: `About: ${subject}`.slice(0, 200),
  };
}

// The brief, with the ad's own words as its opening line: the first line of
// the ad that reads like a sentence, or else its first line.
export function briefFor(ad: string): BriefAnswer {
  const lines = ad
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const quote = lines.find((l) => l.length >= 30 && !/^[-•]\s/.test(l)) ?? lines[0] ?? FAKE_BRIEF.opening.quote;
  return { ...FAKE_BRIEF, opening: { ...FAKE_BRIEF.opening, quote: quote.slice(0, 300) } };
}

export function createSmartFake() {
  let mode: SmartMode = 'smart';
  const provider = new FakeAiProvider((req) => {
    if (mode === 'fail') return new AiUnavailableError(FAIL_MESSAGE);
    if (mode === 'bad') return 'Sorry, I cannot help with that.';
    const user = req.messages[1]?.content ?? '';
    const ad = user.split('The job ad:').pop() ?? '';
    if (req.jsonSchema?.name === 'parsed_job') return JSON.stringify(readAdLikeAPerson(ad));
    if (req.jsonSchema?.name === 'brief') return JSON.stringify(briefFor(ad));
    if (req.jsonSchema?.name === 'prep_plan') return JSON.stringify(FAKE_PREP);
    if (req.jsonSchema?.name === 'rating') return JSON.stringify(FAKE_RATING);
    if (req.jsonSchema?.name === 'card_rating') return JSON.stringify(FAKE_CARD_RATING);
    if (req.jsonSchema?.name === 'email_classification') {
      return JSON.stringify(readEmailLikeAPerson(req.messages[0]?.content ?? '', req.messages[1]?.content ?? ''));
    }
    // Only the user part's first line says which it is: the four writing
    // tasks share their system part, and your guides can mention the other.
    if (!req.jsonSchema) return /cover letter/i.test(user.split('\n')[0]!) ? FAKE_COVER_LETTER : FAKE_RESUME;
    return 'OK';
  });
  return {
    provider,
    setMode(next: SmartMode) {
      mode = next;
      provider.delayMs = next === 'slow' ? 1500 : 0;
      // Slow writing, so a test can press Stop part-way.
      provider.chunkDelayMs = next === 'slow' ? 150 : 0;
    },
  };
}
