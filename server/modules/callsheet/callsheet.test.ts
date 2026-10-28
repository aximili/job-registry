import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeAiProvider } from '../../../tests/fakes/fake-ai-provider.ts';
import { seekCapture } from '../../../tests/helpers/jobs.ts';
import { AiUnavailableError } from '../../core/errors.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';

let app: TestApp;
let clock: Date;
beforeEach(async () => {
  clock = new Date('2026-10-28T03:15:00.000Z');
  app = await createTestApp({ now: () => clock });
});
afterEach(async () => {
  await app.cleanup();
});

const later = (hours: number) => new Date(clock.getTime() + hours * 3_600_000);

it('returns job, postings, history, people, notes and interactions, newest first', async () => {
  const saved = app.services.jobs.save({ capture: seekCapture('1'), fields: { title: 'Senior Engineer', company: 'Atlassian' } });
  if (saved.result !== 'created') throw new Error('setup failed');
  const id = saved.job.id;
  clock = later(1);
  app.services.jobs.changeStatus(id, 'applied', 'manual');
  const firstNote = app.services.notes.add(id, 'Applied with v2 of my resume.');
  clock = later(1);
  const secondNote = app.services.notes.add(id, 'Recruiter called back.');
  app.services.contacts.logInteraction({ newContact: { name: 'Priya Shah' }, jobId: id, kind: 'call', notes: 'Screening call' });

  const res = await app.request('GET', `/api/v1/jobs/${id}/callsheet`);
  expect(res.status).toBe(200);
  const sheet = res.body;
  expect(sheet.job).toMatchObject({ id, title: 'Senior Engineer', status: 'applied' });
  expect(sheet.postings).toHaveLength(1);
  expect(sheet.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['applied', 'saved']);
  expect(sheet.notes.map((n: { id: number }) => n.id)).toEqual([secondNote.id, firstNote.id]);
  expect(sheet.people).toEqual([expect.objectContaining({ name: 'Priya Shah', relation: 'recruiter' })]);
  expect(sheet.interactions).toEqual([expect.objectContaining({ contactName: 'Priya Shah', notes: 'Screening call' })]);
});

it('is a 404 for an unknown job', async () => {
  const res = await app.request('GET', '/api/v1/jobs/999/callsheet');
  expect(res.status).toBe(404);
  expect(res.body.error.message).toBe('Job 999 not found');
});

it('works for a job with no title yet, as pasted ads have until the AI reads them', async () => {
  await app.cleanup();
  const ai = new FakeAiProvider(() => new AiUnavailableError("Can't reach the AI."));
  app = await createTestApp({ now: () => clock, fakes: { ai } });
  const saved = app.services.jobs.save({ capture: seekCapture('1'), fields: { company: 'Atlassian' } });
  if (saved.result !== 'created') throw new Error('setup failed');
  await app.services.enrich.onIdle();
  const res = await app.request('GET', `/api/v1/jobs/${saved.job.id}/callsheet`);
  expect(res.status).toBe(200);
  expect(res.body.job).toMatchObject({ title: null, company: 'Atlassian', parseState: 'pending' });

  const search = await app.request('GET', '/api/v1/search?q=atlassian');
  expect(search.status).toBe(200);
  expect(search.body.hits).toEqual([expect.objectContaining({ kind: 'job', jobId: saved.job.id, title: null })]);
});
