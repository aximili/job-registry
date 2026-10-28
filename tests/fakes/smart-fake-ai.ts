// A fake AI for the browser tests that actually reads the pasted ad a little,
// so a test can paste an ad and see its own details come back:
//   line 1 → role, line 2 → company, the first "$…" amount or range → salary,
//   lines starting with "- " or "• " → requirements.
// Modes: "smart" (the default), "fail" (the AI can't be reached), "slow",
// and "bad" (an answer that never fits).

import type { ParsedJob } from '../../shared/contracts/index.ts';
import { AiUnavailableError } from '../../server/core/errors.ts';
import { FAKE_RATING, FakeAiProvider } from './fake-ai-provider.ts';

export type SmartMode = 'smart' | 'fail' | 'slow' | 'bad';

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

export function createSmartFake() {
  let mode: SmartMode = 'smart';
  const provider = new FakeAiProvider((req) => {
    if (mode === 'fail') return new AiUnavailableError(FAIL_MESSAGE);
    if (mode === 'bad') return 'Sorry, I cannot help with that.';
    if (req.jsonSchema?.name === 'parsed_job') {
      const user = req.messages[1]?.content ?? '';
      const ad = user.split('The job ad:').pop() ?? '';
      return JSON.stringify(readAdLikeAPerson(ad));
    }
    if (req.jsonSchema?.name === 'rating') return JSON.stringify(FAKE_RATING);
    return 'OK';
  });
  return {
    provider,
    setMode(next: SmartMode) {
      mode = next;
      provider.delayMs = next === 'slow' ? 1500 : 0;
    },
  };
}
