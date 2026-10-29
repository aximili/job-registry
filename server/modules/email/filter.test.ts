import { describe, expect, it } from 'vitest';
import { firstFilter, type FilterJob } from './filter.ts';

const own = { ownAddress: 'me@gmail.com' };

function job(id: number, extra: Partial<FilterJob> = {}): FilterJob {
  return { id, company: null, agency: null, contactEmails: [], updatedAt: `2026-10-${String(10 + id).padStart(2, '0')}T00:00:00.000Z`, ...extra };
}

const atlassian = job(1, { company: 'Atlassian Pty Ltd' });
const canva = job(2, { company: 'Canva' });
const hays = job(3, { company: null, agency: 'Hays Recruitment' });
const withRecruiter = job(4, { company: 'Telstra', contactEmails: ['Sam.Lee@Gmail.com'] });
const jobs = [atlassian, canva, hays, withRecruiter];

const email = (from: string, subject: string, text = 'Hello.') => ({ from, subject, text });

describe('firstFilter', () => {
  it('passes an email from a contact, by address, in any case', () => {
    expect(firstFilter(email('sam.lee@gmail.com', 'Quick chat?'), jobs, own)).toEqual({ pass: true, jobIds: [4], reason: 'contact' });
  });

  it("passes an email from the company's own domain", () => {
    expect(firstFilter(email('careers@mail.atlassian.com', 'Hello'), jobs, own)).toEqual({ pass: true, jobIds: [1], reason: 'domain' });
  });

  it("matches an agency's domain by the first word of its name", () => {
    expect(firstFilter(email('jobs@hays.com.au', 'Hello'), jobs, own)).toEqual({ pass: true, jobIds: [3], reason: 'domain' });
  });

  it("passes an email from a contact's work domain", () => {
    const withWorkContact = [job(5, { company: 'Acme', contactEmails: ['jo@talentco.com.au'] })];
    expect(firstFilter(email('kim@talentco.com.au', 'Hello'), withWorkContact, own)).toMatchObject({ pass: true, jobIds: [5], reason: 'domain' });
  });

  it('never matches free mail by domain alone', () => {
    expect(firstFilter(email('recruiter@gmail.com', 'Hello'), jobs, own).pass).toBe(false);
  });

  it('passes a company named in the subject', () => {
    expect(firstFilter(email('noreply@myworkday.com', 'Your application to Canva'), jobs, own)).toEqual({ pass: true, jobIds: [2], reason: 'name' });
  });

  it('passes a company named in the text only with a job word', () => {
    expect(firstFilter(email('news@example.com', 'Weekly news', 'Canva launched a new feature.'), jobs, own).pass).toBe(false);
    expect(
      firstFilter(email('noreply@myworkday.com', 'Update', 'Thanks for your interest in the role at Atlassian.'), jobs, own),
    ).toEqual({ pass: true, jobIds: [1], reason: 'name' });
  });

  it('passes an application email from anyone, with no job', () => {
    expect(firstFilter(email('noreply@ats.example', 'Thank you for applying'), jobs, own)).toEqual({ pass: true, jobIds: [], reason: 'keyword' });
  });

  it('lets a newsletter about interviews through no gate', () => {
    expect(firstFilter(email('tips@careers.example', '5 interview tips', 'Prepare for your next interview.'), jobs, own).pass).toBe(false);
  });

  it('skips email from your own address', () => {
    expect(firstFilter(email('Me@Gmail.com', 'Your application to Canva'), jobs, own)).toEqual({ pass: false, jobIds: [], reason: null });
  });

  it('gives at most five jobs, the most recently updated first', () => {
    const many = Array.from({ length: 7 }, (_, i) => job(i + 1, { company: 'Atlassian' }));
    expect(firstFilter(email('careers@atlassian.com', 'Hi'), many, own).jobIds).toEqual([7, 6, 5, 4, 3]);
  });
});
