import { describe, expect, it } from 'vitest';
import { Capture, DEFAULT_SETTINGS, SaveJobRequest, Settings, Status } from './index.ts';

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
