// The Edit dialog's form, and the patch it sends. Only the fields you changed
// go to the server, so a field the AI filled in while the dialog was open
// isn't overwritten with the old value, and isn't marked as yours.

import type { EmploymentType, Job, UpdateJobRequest, WorkMode } from '../../../shared/contracts/index.ts';
import { formatSalary } from './format.ts';

export type EditForm = {
  title: string;
  company: string;
  agency: string;
  location: string;
  workMode: WorkMode;
  employmentType: EmploymentType;
  salary: string;
  closingDate: string;
  dateApplied: string;
  summary: string;
  requirements: string;
};

// Before the dialog first opens.
export function emptyForm(): EditForm {
  return {
    title: '',
    company: '',
    agency: '',
    location: '',
    workMode: 'unknown',
    employmentType: 'unknown',
    salary: '',
    closingDate: '',
    dateApplied: '',
    summary: '',
    requirements: '',
  };
}

export function formFromJob(job: Job): EditForm {
  return {
    title: job.title ?? '',
    company: job.company ?? '',
    agency: job.agency ?? '',
    location: job.location ?? '',
    workMode: job.workMode,
    employmentType: job.employmentType,
    // A salary read as min and max shows here as text, so the box isn't empty.
    salary: job.salary.text ?? formatSalary(job.salary),
    closingDate: job.closingDate ?? '',
    dateApplied: job.dateApplied ?? '',
    summary: job.summary ?? '',
    requirements: job.requirements.join('\n'),
  };
}

const lines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

export function buildPatch(start: EditForm, now: EditForm, job: Job): UpdateJobRequest {
  const patch: UpdateJobRequest = {};
  const changed = (key: keyof EditForm) => now[key] !== start[key];
  for (const key of ['title', 'company', 'agency', 'location', 'summary'] as const) {
    if (changed(key)) patch[key] = now[key];
  }
  if (changed('workMode')) patch.workMode = now.workMode;
  if (changed('employmentType')) patch.employmentType = now.employmentType;
  if (changed('salary')) {
    // A new text keeps min and max. An empty box means "no salary": all of it goes.
    const text = now.salary.trim();
    patch.salary = text ? { ...job.salary, text } : { min: null, max: null, currency: null, period: null, text: null };
  }
  if (changed('closingDate')) patch.closingDate = now.closingDate || null;
  if (changed('dateApplied')) patch.dateApplied = now.dateApplied || null;
  if (changed('requirements')) patch.requirements = lines(now.requirements);
  return patch;
}
