import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pastedCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';
import { ValidationError } from '../../core/errors.ts';

let app: TestApp;
let clock: Date;
let jobId: number;
let events: [string, unknown][];

beforeEach(async () => {
  clock = new Date('2026-10-28T03:15:00.000Z');
  app = await createTestApp({ now: () => clock });
  const saved = app.services.jobs.save({ capture: pastedCapture() });
  if (saved.result !== 'created') throw new Error('setup failed');
  jobId = saved.job.id;
  events = [];
  app.bus.onAny((name, payload) => events.push([name, payload]));
});
afterEach(async () => {
  await app.cleanup();
});

describe('notes', () => {
  it('add trims the body and refuses an empty note', () => {
    const note = app.services.notes.add(jobId, '  Called Priya, second round next week.  ');
    expect(note).toMatchObject({ jobId, body: 'Called Priya, second round next week.', createdAt: clock.toISOString() });
    expect(() => app.services.notes.add(jobId, '   ')).toThrow(new ValidationError("A note can't be empty."));
    expect(events).toEqual([['note.added', { jobId, noteId: note.id }]]);
  });

  it('lists notes newest first', () => {
    const first = app.services.notes.add(jobId, 'first');
    clock = new Date('2026-10-29T03:15:00.000Z');
    const second = app.services.notes.add(jobId, 'second');
    expect(app.services.notes.listForJob(jobId).map((n) => n.id)).toEqual([second.id, first.id]);
  });

  it('update and remove emit note.updated and note.removed', () => {
    const note = app.services.notes.add(jobId, 'draft');
    events = [];
    clock = new Date('2026-10-29T03:15:00.000Z');
    expect(app.services.notes.update(note.id, 'final')).toMatchObject({ body: 'final', updatedAt: clock.toISOString() });
    app.services.notes.remove(note.id);
    expect(app.services.notes.listForJob(jobId)).toEqual([]);
    expect(events).toEqual([
      ['note.updated', { jobId, noteId: note.id }],
      ['note.removed', { jobId, noteId: note.id }],
    ]);
  });

  it('adding a note to an unknown job is a 404', async () => {
    const res = await app.request('POST', '/api/v1/jobs/999/notes', { body: 'hello' });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Job 999 not found');
  });

  it('routes: add 201, list, edit, delete 204', async () => {
    const added = await app.request('POST', `/api/v1/jobs/${jobId}/notes`, { body: 'via API' });
    expect(added.status).toBe(201);
    expect((await app.request('GET', `/api/v1/jobs/${jobId}/notes`)).body).toHaveLength(1);
    expect((await app.request('PATCH', `/api/v1/notes/${added.body.id}`, { body: 'edited' })).body.body).toBe('edited');
    expect((await app.request('DELETE', `/api/v1/notes/${added.body.id}`)).status).toBe(204);
    expect((await app.request('DELETE', `/api/v1/notes/${added.body.id}`)).status).toBe(404);
  });
});
