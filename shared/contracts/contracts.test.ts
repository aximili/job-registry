import { describe, expect, it } from 'vitest';
import { Capture, DEFAULT_SETTINGS, IsoDateTime, Rating, SaveJobRequest, Settings, Status } from './index.ts';

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

describe('contracts: times', () => {
  it('a time with a time-zone offset is stored in UTC', () => {
    expect(IsoDateTime.parse('2026-10-28T14:15:00+11:00')).toBe('2026-10-28T03:15:00.000Z');
    expect(IsoDateTime.parse('2026-10-28T03:15:00.000Z')).toBe('2026-10-28T03:15:00.000Z');
    expect(IsoDateTime.safeParse('28/10/2026').success).toBe(false);
  });
});

