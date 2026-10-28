import { z } from 'zod';
import { LocalDate } from './common.ts';

// The fields read out of a job ad, by the ad's own structured data or by the AI.

export const WorkMode = z.enum(['onsite', 'hybrid', 'remote', 'unknown']);
export type WorkMode = z.infer<typeof WorkMode>;

export const EmploymentType = z.enum(['full-time', 'part-time', 'contract', 'temporary', 'casual', 'unknown']);
export type EmploymentType = z.infer<typeof EmploymentType>;

export const SalaryPeriod = z.enum(['year', 'day', 'hour']);
export type SalaryPeriod = z.infer<typeof SalaryPeriod>;

// min and max allow decimals, because hourly rates often have cents.
export const Salary = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  currency: z.string().nullable(),
  period: SalaryPeriod.nullable(),
  text: z.string().nullable(),
});
export type Salary = z.infer<typeof Salary>;

export const AdContact = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type AdContact = z.infer<typeof AdContact>;

export const ParsedJob = z.object({
  title: z.string().nullable(),
  company: z.string().nullable(),
  agency: z.string().nullable(),
  location: z.string().nullable(),
  workMode: WorkMode,
  employmentType: EmploymentType,
  salary: Salary,
  closingDate: LocalDate.nullable(),
  summary: z.string(),
  requirements: z.array(z.string()),
  niceToHave: z.array(z.string()),
  responsibilities: z.array(z.string()),
  adContact: AdContact.nullable(),
});
export type ParsedJob = z.infer<typeof ParsedJob>;
