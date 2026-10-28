import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pastedCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.ts';

let app: TestApp;
let clock: Date;
let jobA: number;
let jobB: number;
let events: [string, unknown][];

function saveJob(title: string, company: string): number {
  const saved = app.services.jobs.save({ capture: pastedCapture(`${title} at ${company}`), fields: { title, company } });
  if (saved.result !== 'created') throw new Error('setup failed');
  return saved.job.id;
}

beforeEach(async () => {
  clock = new Date('2026-10-28T03:15:00.000Z');
  app = await createTestApp({ now: () => clock });
  jobA = saveJob('Senior Engineer', 'Atlassian');
  jobB = saveJob('Platform Engineer', 'Canva');
  await app.services.enrich.onIdle();
  events = [];
  app.bus.onAny((name, payload) => {
    if (name.startsWith('document.')) events.push([name, payload]);
  });
});
afterEach(async () => {
  await app.cleanup();
});

const later = (minutes: number) => {
  clock = new Date(clock.getTime() + minutes * 60_000);
};

describe('document versions', () => {
  it('count up per job and kind, and are listed newest first', () => {
    const docs = app.services.documents;
    const r1 = docs.saveVersion(jobA, { kind: 'resume', markdown: '# Sam\nv1', origin: 'generated' });
    later(1);
    const r2 = docs.saveVersion(jobA, { kind: 'resume', markdown: '# Sam\nv2', origin: 'edited' });
    later(1);
    const c1 = docs.saveVersion(jobA, { kind: 'cover_letter', markdown: 'Dear Hiring Manager,', origin: 'edited' });
    expect([r1.version, r2.version, c1.version]).toEqual([1, 2, 1]);
    expect(r1).toMatchObject({ jobId: jobA, kind: 'resume', origin: 'generated', isSent: false, sentAt: null, sentCss: null });
    expect(docs.list(jobA).map((d) => d.id)).toEqual([c1.id, r2.id, r1.id]);
    expect(docs.list(jobB)).toEqual([]);
    expect(events).toEqual([
      ['document.saved', { jobId: jobA, documentId: r1.id }],
      ['document.saved', { jobId: jobA, documentId: r2.id }],
      ['document.saved', { jobId: jobA, documentId: c1.id }],
    ]);
  });

  it('refuse an unknown job and an empty document, and trim only the end', () => {
    const docs = app.services.documents;
    expect(() => docs.saveVersion(999, { kind: 'resume', markdown: '# Sam', origin: 'edited' })).toThrow(new NotFoundError('Job 999 not found'));
    expect(() => docs.saveVersion(jobA, { kind: 'resume', markdown: ' \n\t ', origin: 'edited' })).toThrow(
      new ValidationError("A document can't be empty."),
    );
    expect(docs.saveVersion(jobA, { kind: 'resume', markdown: '  # Sam  \n\n', origin: 'edited' }).markdown).toBe('  # Sam');
    expect(() => docs.get(12345)).toThrow(new NotFoundError('Document 12345 not found'));
  });

  it('copy a version from another job as a new version, marked as copied', () => {
    const docs = app.services.documents;
    const source = docs.saveVersion(jobA, { kind: 'resume', markdown: '# Sam\nfrom A', origin: 'edited' });
    docs.saveVersion(jobB, { kind: 'resume', markdown: '# Sam\nB v1', origin: 'edited' });
    const copy = docs.copyFrom(jobB, source.id);
    expect(copy).toMatchObject({ jobId: jobB, kind: 'resume', version: 2, origin: 'copied', copiedFromId: source.id, markdown: '# Sam\nfrom A' });
  });
});

describe('mark as sent', () => {
  it('freezes the template CSS: changing the template afterwards never changes the sent copy', () => {
    const docs = app.services.documents;
    app.services.profile.write('resume', 'h1 { color: navy; }');
    const doc = docs.saveVersion(jobA, { kind: 'resume', markdown: '# Sam', origin: 'edited' });
    const sent = docs.markSent(doc.id);
    expect(sent).toMatchObject({ isSent: true, sentAt: clock.toISOString(), sentCss: 'h1 { color: navy; }' });

    app.services.profile.write('resume', 'h1 { color: red; }');
    later(5);
    const again = docs.markSent(doc.id);
    expect(again.sentCss).toBe('h1 { color: navy; }');
    expect(again.sentAt).toBe(sent.sentAt);
    expect(events.filter(([name]) => name === 'document.sent')).toEqual([['document.sent', { jobId: jobA, documentId: doc.id }]]);
  });

  it('uses the cover letter template for a cover letter', () => {
    app.services.profile.write('cover-letter', 'p { line-height: 2; }');
    const doc = app.services.documents.saveVersion(jobA, { kind: 'cover_letter', markdown: 'Dear Hiring Manager,', origin: 'edited' });
    expect(app.services.documents.markSent(doc.id).sentCss).toBe('p { line-height: 2; }');
  });

  it('keeps earlier sent versions sent, and latestSent gives the newest per kind', () => {
    const docs = app.services.documents;
    const v1 = docs.saveVersion(jobA, { kind: 'resume', markdown: '# v1', origin: 'edited' });
    const v2 = docs.saveVersion(jobA, { kind: 'resume', markdown: '# v2', origin: 'edited' });
    expect(docs.latestSent(jobA)).toEqual({ resume: null, coverLetter: null });
    docs.markSent(v1.id);
    later(1);
    docs.markSent(v2.id);
    expect(docs.get(v1.id).isSent).toBe(true);
    const latest = docs.latestSent(jobA);
    expect(latest.resume).toMatchObject({ id: v2.id, version: 2 });
    expect(latest.coverLetter).toBeNull();
    expect(latest.resume).not.toHaveProperty('markdown');
  });

  it('saving a new version never touches a sent one', () => {
    const docs = app.services.documents;
    const sent = docs.markSent(docs.saveVersion(jobA, { kind: 'resume', markdown: '# sent', origin: 'edited' }).id);
    docs.saveVersion(jobA, { kind: 'resume', markdown: '# newer', origin: 'edited' });
    expect(docs.get(sent.id)).toEqual(sent);
  });

  it('the repo has no way to change a document text', () => {
    const repo = readFileSync(new URL('./repo.ts', import.meta.url), 'utf8');
    expect(repo).not.toMatch(/UPDATE\s+documents\s+SET\s+(?![^;]*\bis_sent\b)/i);
    expect(repo).not.toMatch(/\bmarkdown\s*=/);
    expect(new ConflictError('x').status).toBe(409);
  });
});

describe('document routes', () => {
  it('save, list, get and send through the API', async () => {
    const saved = await app.request('POST', `/api/v1/jobs/${jobA}/documents`, { kind: 'resume', markdown: '# Sam', origin: 'generated' });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ version: 1, origin: 'generated', markdown: '# Sam' });

    const list = await app.request('GET', `/api/v1/jobs/${jobA}/documents`);
    expect(list.body).toEqual([expect.objectContaining({ id: saved.body.id, version: 1 })]);
    expect(list.body[0]).not.toHaveProperty('markdown');

    expect((await app.request('GET', `/api/v1/documents/${saved.body.id}`)).body.markdown).toBe('# Sam');
    const sent = await app.request('POST', `/api/v1/documents/${saved.body.id}/sent`, {});
    expect(sent.status).toBe(200);
    expect(sent.body.isSent).toBe(true);
  });

  it('a body with fromDocumentId copies that version', async () => {
    const source = app.services.documents.saveVersion(jobA, { kind: 'cover_letter', markdown: 'Dear Hiring Manager,', origin: 'edited' });
    const res = await app.request('POST', `/api/v1/jobs/${jobB}/documents`, { fromDocumentId: source.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ jobId: jobB, kind: 'cover_letter', origin: 'copied', copiedFromId: source.id });
  });

  it('lists one kind across jobs, newest first, with each job title and company', async () => {
    const a = app.services.documents.saveVersion(jobA, { kind: 'resume', markdown: '# A', origin: 'edited' });
    later(1);
    const b = app.services.documents.saveVersion(jobB, { kind: 'resume', markdown: '# B', origin: 'edited' });
    app.services.documents.saveVersion(jobB, { kind: 'cover_letter', markdown: 'Dear', origin: 'edited' });
    const res = await app.request('GET', '/api/v1/documents?kind=resume');
    expect(res.body).toEqual([
      expect.objectContaining({ id: b.id, jobTitle: 'Platform Engineer', company: 'Canva' }),
      expect.objectContaining({ id: a.id, jobTitle: 'Senior Engineer', company: 'Atlassian' }),
    ]);
  });

  it('refuses a document that is too long, and a bad kind', async () => {
    const long = await app.request('POST', `/api/v1/jobs/${jobA}/documents`, { kind: 'resume', markdown: 'x'.repeat(100_001) });
    expect(long.status).toBe(400);
    const bad = await app.request('POST', `/api/v1/jobs/${jobA}/documents`, { kind: 'poem', markdown: 'x' });
    expect(bad.status).toBe(400);
    expect((await app.request('GET', '/api/v1/documents/999')).status).toBe(404);
  });
});
