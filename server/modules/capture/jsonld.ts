// Reads schema.org JobPosting data, which many job sites put in the page for
// search engines. It's more reliable than scraping the visible page.

import type { EmploymentType, ParsedJob, SalaryPeriod } from '../../../shared/contracts/index.ts';
import { htmlFragmentToText } from './text.ts';

type Json = Record<string, unknown>;

const LD_SCRIPT = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export function extractJobPosting(html: string): { structured: Partial<ParsedJob>; descriptionText: string | null } | null {
  for (const match of html.matchAll(LD_SCRIPT)) {
    let data: unknown;
    try {
      data = JSON.parse(match[1] ?? '');
    } catch {
      continue;
    }
    const posting = findPosting(data);
    if (posting) return mapPosting(posting);
  }
  return null;
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

function mapPosting(p: Json): { structured: Partial<ParsedJob>; descriptionText: string | null } {
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
  const closing = text(p.validThrough)?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (closing) structured.closingDate = closing;
  const locationTypes = Array.isArray(p.jobLocationType) ? p.jobLocationType : [p.jobLocationType];
  if (locationTypes.includes('TELECOMMUTE')) structured.workMode = 'remote';

  const description = text(p.description);
  return { structured, descriptionText: description ? htmlFragmentToText(description) : null };
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
