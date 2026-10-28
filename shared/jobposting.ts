// schema.org JobPosting data, which many job sites put in their pages for
// search engines. It's more reliable than reading the visible page. This
// maps it to our fields, and is shared by the server (pasted links) and the
// browser extension (the page you have open). The description stays HTML:
// each side turns it into text its own way.

import type { EmploymentType, ParsedJob, SalaryPeriod } from './contracts/index.ts';
import { localDate } from './dates.ts';

type Json = Record<string, unknown>;

export type MappedJobPosting = { structured: Partial<ParsedJob>; descriptionHtml: string | null };

// Finds a JobPosting in parsed JSON-LD (an object, an array or an @graph).
export function mapJobPosting(data: unknown): MappedJobPosting | null {
  const posting = findPosting(data);
  return posting ? mapPosting(posting) : null;
}

function findPosting(data: unknown): Json | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findPosting(item);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(data)) return null;
  const type = data['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return data;
  return data['@graph'] ? findPosting(data['@graph']) : null;
}

function mapPosting(p: Json): { structured: Partial<ParsedJob>; descriptionHtml: string | null } {
  const structured: Partial<ParsedJob> = {};
  const title = text(p.title);
  if (title) structured.title = title;
  const company = isObject(p.hiringOrganization) ? text(p.hiringOrganization.name) : text(p.hiringOrganization);
  if (company) structured.company = company;
  const location = mapLocation(p.jobLocation);
  if (location) structured.location = location;
  const employmentType = mapEmploymentType(p.employmentType);
  if (employmentType !== 'unknown') structured.employmentType = employmentType;
  const salary = mapSalary(p.baseSalary);
  if (salary) structured.salary = salary;
  const closing = closingDate(text(p.validThrough));
  if (closing) structured.closingDate = closing;
  const locationTypes = Array.isArray(p.jobLocationType) ? p.jobLocationType : [p.jobLocationType];
  if (locationTypes.includes('TELECOMMUTE')) structured.workMode = 'remote';

  return { structured, descriptionHtml: text(p.description) };
}

// The day applications close. A time with an offset (+11:00) is the poster's
// own clock, so its date is the one they meant. A UTC time ("Z") is turned
// into your local date: 2:00 pm UTC on 30 Nov is 1:00 am on 1 Dec in Sydney.
function closingDate(value: string | null): string | null {
  const date = value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!value || !date) return null;
  if (/T.*Z$/i.test(value)) {
    const moment = new Date(value);
    return Number.isNaN(moment.getTime()) ? date : localDate(moment);
  }
  return date;
}

function mapLocation(value: unknown): string | null {
  const place = Array.isArray(value) ? value[0] : value;
  if (!isObject(place)) return text(place);
  const address = place.address;
  if (!isObject(address)) return text(address) ?? text(place.name);
  const parts = [text(address.addressLocality), text(address.addressRegion)].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : text(address.addressCountry);
}

const EMPLOYMENT: Record<string, EmploymentType> = {
  fulltime: 'full-time',
  parttime: 'part-time',
  contractor: 'contract',
  contract: 'contract',
  temporary: 'temporary',
  temp: 'temporary',
  casual: 'casual',
  perdiem: 'casual',
};

function mapEmploymentType(value: unknown): EmploymentType {
  for (const item of Array.isArray(value) ? value : [value]) {
    const key = text(item)?.toLowerCase().replace(/[^a-z]/g, '');
    if (key && EMPLOYMENT[key]) return EMPLOYMENT[key];
  }
  return 'unknown';
}

const PERIOD: Record<string, SalaryPeriod> = { YEAR: 'year', DAY: 'day', HOUR: 'hour' };

function mapSalary(value: unknown): ParsedJob['salary'] | null {
  if (!isObject(value)) return null;
  const amount = value.value;
  const currency = text(value.currency);
  let min: number | null = null;
  let max: number | null = null;
  let unit: string | null = null;
  if (isObject(amount)) {
    min = number(amount.minValue) ?? number(amount.value);
    max = number(amount.maxValue) ?? number(amount.value);
    unit = text(amount.unitText);
  } else {
    min = max = number(amount);
  }
  if (min === null && max === null) return null;
  return { min, max, currency, period: unit ? (PERIOD[unit.toUpperCase()] ?? null) : null, text: null };
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
