import { describe, expect, it } from 'vitest';
import { phoneDigits, queryDigits } from './phone.ts';

describe('phoneDigits', () => {
  it.each([
    ['0412 345 678', '0412345678'],
    ['+61 412 345 678', '0412345678'],
    ['+61 (0)412 345 678', '0412345678'],
    ['0061 412 345 678', '0412345678'],
    ['61412345678', '0412345678'],
    ['(02) 9876 5432', '0298765432'],
    ['+61 2 9876 5432', '0298765432'],
    ['+44 20 7946 0958', '442079460958'],
    ['', ''],
  ])('%s → %s', (raw, expected) => {
    expect(phoneDigits(raw)).toBe(expected);
  });
});

describe('queryDigits', () => {
  it.each([
    ['0412', '0412'],
    ['+61 412', '0412'],
    ['345 678', '345678'],
    ['12', null],
    ['atl', null],
    ['Interview 2 2025', null],
    // "+61 4" is only "04" once it's in local form, which every mobile starts with.
    ['+61 4', null],
    ['0061 4', null],
    ['+61 41', '041'],
  ])('%s → %s', (q, expected) => {
    expect(queryDigits(q)).toBe(expected);
  });
});
