import { describe, expect, it } from 'vitest';
import { compactCompany, normaliseCompany } from './company.ts';

describe('normaliseCompany', () => {
  it.each([
    ['Atlassian Pty Ltd', 'atlassian'],
    ['Atlassian Australia', 'atlassian'],
    ['The Commonwealth Bank of Australia', 'commonwealth bank'],
    ['Canva Group Holdings', 'canva'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseCompany(input)).toBe(expected);
  });
});

describe('compactCompany', () => {
  it.each([
    ['Atlassian Pty Ltd', 'atlassian'],
    ['Hays Recruitment', 'haysrecruitment'],
    ['Café Réunion', 'cafereunion'],
  ])('%s → %s', (input, expected) => {
    expect(compactCompany(input)).toBe(expected);
  });
});
