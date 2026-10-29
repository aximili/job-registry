import { describe, expect, it } from 'vitest';
import { openDb } from '../../core/db/db.ts';
import { createEmailRepo, type NewSuggestionRow } from './repo.ts';

function setup() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO jobs (title, status, created_at, updated_at) VALUES ('Engineer', 'applied', 'now', 'now')").run();
  return createEmailRepo(db);
}

function row(messageId: string, receivedAt: string, extra: Partial<NewSuggestionRow> = {}): NewSuggestionRow {
  return {
    messageId,
    jobId: 1,
    fromAddr: 'careers@atlassian.com',
    subject: 'Your application',
    receivedAt,
    event: 'rejected',
    suggestedStatus: 'rejected',
    confidence: 0.9,
    summary: 'They will not progress your application.',
    company: 'Atlassian',
    role: 'Engineer',
    state: 'pending',
    createdAt: '2026-10-29T00:00:00.000Z',
    ...extra,
  };
}

describe('email repo', () => {
  it('stores a suggestion and knows the email was seen', () => {
    const repo = setup();
    expect(repo.has('<a@x>')).toBe(false);
    const id = repo.insert(row('<a@x>', '2026-10-27T00:00:00.000Z'));
    expect(repo.has('<a@x>')).toBe(true);
    expect(repo.get(id)).toMatchObject({
      id,
      messageId: '<a@x>',
      jobId: 1,
      event: 'rejected',
      state: 'pending',
      appliedStatus: null,
      handledAt: null,
    });
    expect(repo.get(999)).toBeNull();
  });

  it('keeps an ignored email as just its id and date', () => {
    const repo = setup();
    const id = repo.insert({
      ...row('<b@x>', '2026-10-27T00:00:00.000Z'),
      jobId: null,
      fromAddr: null,
      subject: null,
      event: null,
      suggestedStatus: null,
      confidence: null,
      summary: null,
      company: null,
      role: null,
      state: 'ignored',
    });
    expect(repo.get(id)).toMatchObject({ fromAddr: null, subject: null, summary: null, state: 'ignored' });
  });

  it('handles a suggestion only once', () => {
    const repo = setup();
    const id = repo.insert(row('<a@x>', '2026-10-27T00:00:00.000Z'));
    const at = '2026-10-29T01:00:00.000Z';
    expect(repo.handle(id, 'confirmed', { jobId: 1, appliedStatus: 'rejected', at })).toBe(true);
    expect(repo.handle(id, 'dismissed', { jobId: 1, appliedStatus: null, at })).toBe(false);
    expect(repo.get(id)).toMatchObject({ state: 'confirmed', appliedStatus: 'rejected', handledAt: at });
  });

  it('lists and counts by state, newest email first', () => {
    const repo = setup();
    repo.insert(row('<old@x>', '2026-10-20T00:00:00.000Z'));
    repo.insert(row('<new@x>', '2026-10-28T00:00:00.000Z'));
    repo.insert(row('<gone@x>', '2026-10-25T00:00:00.000Z', { state: 'dismissed' }));
    expect(repo.listByState('pending').map((r) => r.messageId)).toEqual(['<new@x>', '<old@x>']);
    expect(repo.countByState('pending')).toBe(2);
    expect(repo.countByState('dismissed')).toBe(1);
  });

  it('keeps small facts, the last one written wins', () => {
    const repo = setup();
    expect(repo.getValue('cursor')).toBeNull();
    repo.setValue('cursor', '{"uidValidity":"1","lastUid":3}');
    repo.setValue('cursor', '{"uidValidity":"1","lastUid":5}');
    expect(repo.getValue('cursor')).toBe('{"uidValidity":"1","lastUid":5}');
    repo.deleteValue('cursor');
    expect(repo.getValue('cursor')).toBeNull();
  });
});
