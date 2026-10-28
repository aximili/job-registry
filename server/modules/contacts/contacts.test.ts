import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pastedCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';

let app: TestApp;
let clock: Date;
let jobId: number;
let events: [string, unknown][];

function newJob(title = 'Senior Engineer'): number {
  const saved = app.services.jobs.save({ capture: pastedCapture(), fields: { title }, decision: 'new' });
  if (saved.result !== 'created') throw new Error('setup failed');
  return saved.job.id;
}

beforeEach(async () => {
  clock = new Date('2026-10-28T03:15:00.000Z');
  app = await createTestApp({ now: () => clock });
  jobId = newJob();
  events = [];
  app.bus.onAny((name, payload) => events.push([name, payload]));
});
afterEach(async () => {
  await app.cleanup();
});

describe('contacts', () => {
  it('stores phone_digits normalised and finds a contact by any part of the number', () => {
    const priya = app.services.contacts.create({ name: 'Priya Shah', phone: '+61 412 345 678' });
    expect(app.services.contacts.findByPhoneDigits('345678')).toEqual([{ contactId: priya.id, jobIds: [] }]);
    expect(app.services.contacts.findByPhoneDigits('0412')).toEqual([{ contactId: priya.id, jobIds: [] }]);
    expect(app.services.contacts.findByPhoneDigits('999')).toEqual([]);
    expect(app.services.contacts.list('345 678').map((c) => c.name)).toEqual(['Priya Shah']);
  });

  it('list escapes % and _ in the search text', () => {
    app.services.contacts.create({ name: 'Sam 100% Recruiting' });
    app.services.contacts.create({ name: 'Sam Lee' });
    expect(app.services.contacts.list('100%').map((c) => c.name)).toEqual(['Sam 100% Recruiting']);
    expect(app.services.contacts.list('_')).toEqual([]);
    expect(app.services.contacts.list('sam').map((c) => c.name)).toEqual(['Sam 100% Recruiting', 'Sam Lee']);
  });

  it('logInteraction with newContact creates the person, links them to the job and logs the call in one transaction', () => {
    const call = app.services.contacts.logInteraction({
      newContact: { name: 'Priya Shah', phone: '0412 345 678', organisation: 'Hays' },
      jobId,
      kind: 'call',
      notes: 'Second round next Tuesday.',
    });
    expect(call).toMatchObject({ contactName: 'Priya Shah', jobId, kind: 'call', notes: 'Second round next Tuesday.' });
    expect(app.services.contacts.listForJob(jobId)).toEqual([
      expect.objectContaining({ name: 'Priya Shah', relation: 'recruiter', lastInteractionAt: clock.toISOString() }),
    ]);
    expect(app.services.contacts.listInteractionsForJob(jobId)).toHaveLength(1);
  });

  it('a failed logInteraction leaves nothing behind', () => {
    expect(() =>
      app.services.contacts.logInteraction({ newContact: { name: 'Ghost' }, jobId: 999, kind: 'call', notes: '' }),
    ).toThrow('Job 999 not found');
    expect(app.services.contacts.list('Ghost')).toEqual([]);
  });

  it('logInteraction links an existing contact to the job as recruiter if not linked yet', () => {
    const sam = app.services.contacts.create({ name: 'Sam Lee' });
    app.services.contacts.logInteraction({ contactId: sam.id, jobId, kind: 'email', notes: 'Sent CV' });
    expect(app.services.contacts.listJobIdsForContact(sam.id)).toEqual([jobId]);
    expect(app.services.contacts.listForJob(jobId)[0]?.relation).toBe('recruiter');
  });

  it('logInteraction defaults kind to call and happenedAt to now, and allows empty notes', async () => {
    const res = await app.request('POST', '/api/v1/interactions', { jobId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'call', happenedAt: clock.toISOString(), notes: '', contactId: null, contactName: null });
  });

  it('emits contact.saved, contact.linked and interaction.logged', () => {
    const call = app.services.contacts.logInteraction({ newContact: { name: 'Priya' }, jobId, kind: 'call', notes: '' });
    expect(events.map(([name]) => name)).toEqual(['contact.saved', 'contact.linked', 'interaction.logged']);
    expect(events[2]?.[1]).toEqual({ interactionId: call.id, contactId: call.contactId, jobId });
  });

  it('listForJob includes relation and the latest interaction time', () => {
    const sam = app.services.contacts.create({ name: 'Sam Lee' });
    app.services.contacts.linkToJob(jobId, { contactId: sam.id, relation: 'hiring_manager' });
    expect(app.services.contacts.listForJob(jobId)[0]).toMatchObject({ relation: 'hiring_manager', lastInteractionAt: null });
    clock = new Date('2026-10-30T00:00:00.000Z');
    app.services.contacts.logInteraction({ contactId: sam.id, jobId, kind: 'meeting', notes: 'Coffee' });
    expect(app.services.contacts.listForJob(jobId)[0]).toMatchObject({
      relation: 'hiring_manager',
      lastInteractionAt: '2026-10-30T00:00:00.000Z',
    });
  });

  it('an unknown job or contact is a 404', async () => {
    expect((await app.request('POST', '/api/v1/jobs/999/contacts', { contactId: 1 })).status).toBe(404);
    const contact = await app.request('POST', '/api/v1/contacts', { name: 'Priya' });
    expect(contact.status).toBe(201);
    expect((await app.request('POST', `/api/v1/jobs/${jobId}/contacts`, { contactId: 999 })).body.error.message).toBe(
      'Contact 999 not found',
    );
    expect((await app.request('PATCH', '/api/v1/contacts/999', { name: 'X' })).status).toBe(404);
    expect((await app.request('DELETE', `/api/v1/jobs/${jobId}/contacts/${contact.body.id}`)).status).toBe(204);
  });
});
