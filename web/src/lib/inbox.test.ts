import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUSES, type EmailEvent } from '../../../shared/contracts/index.ts';
import { doneMessage, eventLabel, questionFor } from './inbox.ts';

const statuses = DEFAULT_STATUSES.map((s) => ({ ...s }));

describe('inbox words', () => {
  it.each<[EmailEvent, string]>([
    ['received', 'Application received'],
    ['rejected', 'Rejection'],
    ['interview', 'Interview invitation'],
    ['assessment', 'Assessment'],
    ['offer', 'Offer'],
    ['other', 'Other email'],
  ])('%s is shown as "%s"', (event, label) => {
    expect(eventLabel(event)).toBe(label);
  });

  it('asks about the status by its label, or offers a note', () => {
    expect(questionFor({ suggestedStatus: 'rejected' }, statuses)).toBe('Mark as Rejected?');
    expect(questionFor({ suggestedStatus: 'interview_1' }, statuses)).toBe('Mark as Interview 1?');
    expect(questionFor({ suggestedStatus: null }, statuses)).toBe('Add it as a note?');
  });

  it('says what Confirm did', () => {
    expect(doneMessage({ appliedStatus: 'rejected', job: { title: 'Senior Engineer' } }, statuses)).toBe('Marked Senior Engineer as Rejected.');
    expect(doneMessage({ appliedStatus: null, job: { title: 'Senior Engineer' } }, statuses)).toBe('Added a note to Senior Engineer.');
    expect(doneMessage({ appliedStatus: null, job: { title: null } }, statuses)).toBe('Added a note to Untitled role.');
  });
});
