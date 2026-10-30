import { describe, expect, it } from 'vitest';
import {
  AiSettings,
  Capture,
  DEFAULT_SETTINGS,
  IsoDateTime,
  JobCard,
  Rating,
  SaveJobRequest,
  SetFollowUpRequest,
  Settings,
  Status,
} from './index.ts';

const capturedAt = '2026-10-28T03:15:00.000Z';

describe('contracts', () => {
  it('parses a minimal pasted capture', () => {
    const capture = Capture.parse({
      sourceUrl: null,
      canonicalUrl: null,
      sourceSite: 'pasted',
      externalId: null,
      jdText: 'x',
      capturedAt,
    });
    expect(capture.sourceSite).toBe('pasted');
  });

  it('accepts both save decisions', () => {
    const capture = { sourceUrl: null, canonicalUrl: null, sourceSite: 'pasted', externalId: null, jdText: 'x', capturedAt };
    expect(SaveJobRequest.safeParse({ capture, decision: 'new' }).success).toBe(true);
    expect(SaveJobRequest.safeParse({ capture, decision: { linkTo: 3 } }).success).toBe(true);
    expect(SaveJobRequest.safeParse({ capture, decision: { linkTo: 'x' } }).success).toBe(false);
  });

  it('rejects a status id with spaces', () => {
    const result = Status.safeParse({ id: 'Interview 1', label: 'Interview 1', closed: false, order: 10, setsAppliedDate: false });
    expect(result.success).toBe(false);
  });

  it('fills every settings default from {}', () => {
    const settings = Settings.parse({});
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.server.port).toBe(4777);
    expect(settings.backups).toEqual({ dir: 'data/backups', keep: 14 });
    expect(settings.statuses).toHaveLength(11);
    expect(settings.statuses.find((s) => s.id === 'applied')?.setsAppliedDate).toBe(true);
    expect(settings.statuses.filter((s) => s.closed).map((s) => s.id)).toEqual(['rejected', 'withdrawn', 'no_response']);
  });

  it('refuses duplicate status ids', () => {
    const [first] = DEFAULT_SETTINGS.statuses;
    const result = Settings.safeParse({ statuses: [first, first] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("Status id 'saved' is used twice.");
  });
});

describe('settings: reserved status ids', () => {
  it('refuses open, closed and all as status ids, because they are list filters', () => {
    const [first] = DEFAULT_SETTINGS.statuses;
    const result = Settings.safeParse({ statuses: [{ ...first, id: 'all' }] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("Status id 'all' is reserved.");
  });
});

describe('contracts: AI', () => {
  it('an empty settings file gets the AI defaults', () => {
    expect(DEFAULT_SETTINGS.ai.preset).toBe('llama-server');
    expect(DEFAULT_SETTINGS.ai.tasks.parse.thinking).toBe(false);
    expect(DEFAULT_SETTINGS.ai.managed.args).toContain('-ngl');
  });

  it('the app never stops the AI when idle unless you turn it on', () => {
    expect(DEFAULT_SETTINGS.ai.stopWhenIdle).toBe(false);
    expect(DEFAULT_SETTINGS.ai.idleMinutes).toBe(15);
    expect(Settings.parse({ ai: { stopWhenIdle: true, idleMinutes: 30 } }).ai).toMatchObject({ stopWhenIdle: true, idleMinutes: 30 });
  });

  it('a partial ai section keeps the other defaults', () => {
    const s = Settings.parse({ ai: { preset: 'ollama', model: 'qwen3:8b', tasks: { parse: { model: 'small' } } } });
    expect(s.ai.tasks.rate.maxTokens).toBe(2048);
    expect(s.ai.tasks.parse).toMatchObject({ model: 'small', temperature: 0.2, maxTokens: 4096 });
    expect(s.ai.managed.enabled).toBe(true);
  });

  it('a misspelt ai key is refused', () => {
    expect(Settings.safeParse({ ai: { modle: 'x' } }).success).toBe(false);
  });

  it('a rating has at most four reasons each way', () => {
    const rating = { verdict: 'good', score: 70, why: ['a', 'b', 'c', 'd'], whyNot: [], dealBreakers: [], salaryNote: null };
    expect(Rating.safeParse(rating).success).toBe(true);
    expect(Rating.safeParse({ ...rating, why: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false);
  });
});

describe('contracts: job cards', () => {
  // A Seek card from a private advertiser: no company name.
  const card = {
    canonicalUrl: 'https://www.seek.com.au/job/81234567',
    sourceSite: 'seek',
    externalId: '81234567',
    title: 'Senior Engineer',
    company: null,
    location: 'Sydney NSW',
    text: 'Private advertiser. $150,000 - $170,000. Build developer tools in TypeScript.',
  };

  it('a Seek card with no company is fine', () => {
    expect(JobCard.safeParse(card).success).toBe(true);
  });

  it('a card needs a title', () => {
    expect(JobCard.safeParse({ ...card, title: '' }).success).toBe(false);
  });

  it("a card's text is 4000 characters at most", () => {
    expect(JobCard.safeParse({ ...card, text: 'x'.repeat(4000) }).success).toBe(true);
    expect(JobCard.safeParse({ ...card, text: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('quick ratings from cards have their own AI settings: short, with thinking off', () => {
    expect(AiSettings.parse({}).tasks.card).toEqual({
      model: null,
      temperature: 0.2,
      maxTokens: 512,
      thinking: false,
      thinkingEffort: 'medium',
      extra: {},
    });
  });

  it('resumes and cover letters think with no limit by default: the AI decides', () => {
    expect(AiSettings.parse({}).tasks.write).toMatchObject({ thinking: true, thinkingEffort: 'max', maxTokens: 8192 });
  });

  it('thinking can be low, medium, high or max, and an older "xhigh" is high', () => {
    for (const effort of ['low', 'medium', 'high', 'max']) {
      expect(AiSettings.parse({ tasks: { rate: { thinkingEffort: effort } } }).tasks.rate.thinkingEffort).toBe(effort);
    }
    expect(AiSettings.parse({ tasks: { rate: { thinkingEffort: 'xhigh' } } }).tasks.rate.thinkingEffort).toBe('high');
    expect(AiSettings.safeParse({ tasks: { rate: { thinkingEffort: 'extreme' } } }).success).toBe(false);
  });
});

describe('contracts: times', () => {
  it('a time with a time-zone offset is stored in UTC', () => {
    expect(IsoDateTime.parse('2026-10-28T14:15:00+11:00')).toBe('2026-10-28T03:15:00.000Z');
    expect(IsoDateTime.parse('2026-10-28T03:15:00.000Z')).toBe('2026-10-28T03:15:00.000Z');
    expect(IsoDateTime.safeParse('28/10/2026').success).toBe(false);
  });
});


describe('contracts: email', () => {
  it('an empty settings file gets the email defaults, with email off', () => {
    expect(Settings.parse({}).email).toEqual({
      enabled: false,
      address: '',
      host: 'imap.gmail.com',
      port: 993,
      mailbox: 'INBOX',
      pollMinutes: 10,
      firstCheckDays: 14,
      maxPerCheck: 100,
    });
  });

  it('checking more often than every 5 minutes is refused', () => {
    expect(Settings.safeParse({ email: { pollMinutes: 1 } }).success).toBe(false);
    expect(Settings.safeParse({ email: { pollMinutes: 5 } }).success).toBe(true);
  });

  it('checking less often than once a day is refused, so the timer never overflows', () => {
    expect(Settings.safeParse({ email: { pollMinutes: 1440 } }).success).toBe(true);
    expect(Settings.safeParse({ email: { pollMinutes: 100_000 } }).success).toBe(false);
  });

  it('reading emails has its own AI settings, with thinking off', () => {
    expect(DEFAULT_SETTINGS.ai.tasks.email).toEqual({
      model: null,
      temperature: 0.1,
      maxTokens: 1024,
      thinking: false,
      thinkingEffort: 'medium',
      extra: {},
    });
  });
});

describe('contracts: follow-ups', () => {
  it('a reason of 200 characters is fine, and a longer one says so plainly', () => {
    expect(SetFollowUpRequest.safeParse({ on: '2026-11-05', note: 'x'.repeat(200) }).success).toBe(true);
    const long = SetFollowUpRequest.safeParse({ on: '2026-11-05', note: 'x'.repeat(201) });
    expect(long.success).toBe(false);
    expect(long.error?.issues[0]?.message).toBe('Keep the reason to 200 characters or fewer.');
  });
});
