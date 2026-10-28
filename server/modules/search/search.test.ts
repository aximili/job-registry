import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EditableJobFields, SearchHit } from '../../../shared/contracts/index.ts';
import { pastedCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp();
});
afterEach(async () => {
  await app.cleanup();
});

function job(fields: Partial<EditableJobFields>, opts: { status?: string; ad?: string } = {}): number {
  const saved = app.services.jobs.save({
    capture: pastedCapture(opts.ad ?? 'An ad.'),
    fields,
    decision: 'new',
    ...(opts.status ? { status: opts.status } : {}),
  });
  if (saved.result !== 'created') throw new Error('setup failed');
  return saved.job.id;
}

const jobIds = (hits: SearchHit[]) => hits.flatMap((h) => (h.kind === 'job' ? [h.jobId] : []));
const search = (q: string) => app.services.search.query(q);

describe('search', () => {
  it('finds a job by the first three letters of the company', () => {
    const id = job({ company: 'Atlassian', title: 'Senior Engineer' });
    job({ company: 'Canva', title: 'Designer' });
    expect(jobIds(search('atl'))).toEqual([id]);
  });

  it('…by agency', () => {
    const id = job({ company: null, agency: 'Hays Recruitment', title: 'Analyst' });
    expect(jobIds(search('hays'))).toEqual([id]);
  });

  it('…by contact name', () => {
    const id = job({ company: 'Xero' });
    app.services.contacts.logInteraction({ newContact: { name: 'Priya Shah' }, jobId: id, kind: 'call', notes: '' });
    expect(jobIds(search('priya'))).toEqual([id]);
  });

  it('…by note text', () => {
    const id = job({ company: 'Xero' });
    app.services.notes.add(id, 'They mentioned a relocation package.');
    expect(jobIds(search('relocation'))).toEqual([id]);
  });

  it('…by ad text', () => {
    const id = job({ company: 'Xero' }, { ad: 'Experience with Kubernetes is a must.' });
    expect(jobIds(search('kubern'))).toEqual([id]);
  });

  it('finds a job by part of a contact phone number, and lists phone matches first', () => {
    const byAd = job({ company: 'Canva' }, { ad: 'Call 345 678 for details.' });
    const byPhone = job({ company: 'Atlassian' });
    app.services.contacts.logInteraction({
      newContact: { name: 'Sam Lee', phone: '+61 412 345 678' },
      jobId: byPhone,
      kind: 'call',
      notes: '',
    });
    expect(jobIds(search('345 678'))).toEqual([byPhone, byAd]);
    expect(jobIds(search('0412345678'))).toEqual([byPhone]);
  });

  it('lists open jobs before closed ones, then by best match', () => {
    const closed = job({ company: 'Canva', title: 'Canva Canva Engineer' }, { status: 'rejected' });
    const open = job({ company: 'Canva', title: 'Engineer' }, { status: 'applied' });
    expect(jobIds(search('canva'))).toEqual([open, closed]);
  });

  it('leaves archived jobs out', () => {
    const id = job({ company: 'Atlassian' });
    app.services.jobs.update(id, { archived: true });
    expect(search('atlassian')).toEqual([]);
  });

  it('returns a contact hit only for a contact with no jobs', () => {
    const id = job({ company: 'Xero' });
    app.services.contacts.logInteraction({ newContact: { name: 'Priya Shah' }, jobId: id, kind: 'call', notes: '' });
    const loner = app.services.contacts.create({ name: 'Priyanka Rao', organisation: 'Robert Walters' });
    const hits = search('priya');
    expect(hits.map((h) => h.kind)).toEqual(['job', 'contact']);
    expect(hits[1]).toMatchObject({ kind: 'contact', contactId: loner.id, name: 'Priyanka Rao', organisation: 'Robert Walters' });
  });

  it('stays up to date through events', () => {
    const id = job({ company: 'Xero' });
    expect(search('visa')).toEqual([]);
    app.services.notes.add(id, 'Asked about visa sponsorship.');
    expect(jobIds(search('visa'))).toEqual([id]);
  });

  it('rebuild restores the index after it is emptied', () => {
    const id = job({ company: 'Atlassian' });
    app.db.exec('DELETE FROM search_index');
    expect(search('atl')).toEqual([]);
    expect(app.services.search.rebuild()).toEqual({ jobs: 1, contacts: 0 });
    expect(jobIds(search('atl'))).toEqual([id]);
  });

  it('answers in under 50 ms on 1,000 jobs', () => {
    const companies = ['Atlassian', 'Canva', 'Xero', 'Seek', 'Telstra', 'Westpac', 'Optus', 'Qantas'];
    for (let i = 0; i < 1000; i++) {
      const id = job(
        { company: `${companies[i % companies.length]} ${i}`, title: `Engineer ${i}` },
        { ad: `Role number ${i}. We build software for Australians. `.repeat(20) },
      );
      if (i % 3 === 0) app.services.notes.add(id, `Note for job ${i}: spoke with the hiring manager.`);
    }
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      search('atl');
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(times[10]).toBeLessThan(50);
  }, 60_000);

  it('snippet marks matches with \\u0001 and \\u0002', () => {
    const id = job({ company: 'Xero' });
    app.services.notes.add(id, 'Great team culture, flexible hours.');
    const [hit] = search('flexible');
    expect(hit?.snippet).toContain('\u0001flexible\u0002');
  });

  it('GET /search and POST /search/rebuild', async () => {
    job({ company: 'Atlassian' });
    const res = await app.request('GET', '/api/v1/search?q=atl');
    expect(res.status).toBe(200);
    expect(res.body.hits).toHaveLength(1);
    expect((await app.request('GET', '/api/v1/search?q=')).body).toEqual({ hits: [] });
    expect((await app.request('POST', '/api/v1/search/rebuild')).body).toEqual({ jobs: 1, contacts: 0 });
  });
});

describe('search: review fixes', () => {
  it('never hides open jobs behind more than 50 closed matches', () => {
    for (let i = 0; i < 60; i++) job({ agency: 'Hays', title: `Old contract ${i}` }, { status: 'rejected' });
    const open = [1, 2, 3, 4, 5].map((i) => job({ agency: 'Hays', title: `Current role ${i}` }, { status: 'applied' }));
    const hits = jobIds(search('hays'));
    expect(hits).toHaveLength(20);
    expect(new Set(hits.slice(0, 5))).toEqual(new Set(open));
  });

  it('finds text pasted from a PDF with ligatures or zero-width characters', () => {
    const pdf = job({ company: 'Xero' }, { ad: 'Join our \uFB01nance o\uFB03ce in Sydney.' });
    const hidden = job({ company: 'Atl\u200Bassian' });
    expect(jobIds(search('finance'))).toEqual([pdf]);
    expect(jobIds(search('office'))).toEqual([pdf]);
    expect(jobIds(search('\uFB01nance'))).toEqual([pdf]);
    expect(jobIds(search('atlassian'))).toEqual([hidden]);
  });
});

describe('search: final review fixes', () => {
  it('finds a phone number copied from Outlook or Teams, with invisible marks or full-width digits', () => {
    const id = job({ company: 'Atlassian' });
    app.services.contacts.logInteraction({ newContact: { name: 'Sam Lee', phone: '0412 345 678' }, jobId: id, kind: 'call', notes: '' });
    expect(jobIds(search('‪0412 345 678‬'))).toEqual([id]);
    expect(jobIds(search('‎+61 412 345 678'))).toEqual([id]);
    expect(jobIds(search('０４１２３４５'))).toEqual([id]);
  });
});
