import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUSES } from '../../../shared/contracts/index.ts';
import { moveStatus, slugifyStatusId } from './statuses.ts';

describe('slugifyStatusId', () => {
  it('slugifies labels and avoids existing ids', () => {
    expect(slugifyStatusId('Phone screen', [])).toBe('phone_screen');
    expect(slugifyStatusId('Phone screen', ['phone_screen'])).toBe('phone_screen_2');
    expect(slugifyStatusId('  Offer!! ', ['offer'])).toBe('offer_2');
    expect(slugifyStatusId('Café chat', [])).toBe('cafe_chat');
    expect(slugifyStatusId('!!!', [])).toBe('status');
  });

  it('never uses the reserved list filters open, closed and all', () => {
    expect(slugifyStatusId('Open', [])).toBe('open_2');
    expect(slugifyStatusId('All', [])).toBe('all_2');
    expect(slugifyStatusId('Closed', [])).toBe('closed_2');
  });
});

describe('moveStatus', () => {
  it('moveStatus renumbers order', () => {
    const [saved, applied, screening] = DEFAULT_STATUSES;
    const list = [saved!, applied!, screening!];
    expect(moveStatus(list, 'screening', -1).map((s) => [s.id, s.order])).toEqual([
      ['saved', 10],
      ['screening', 20],
      ['applied', 30],
    ]);
    expect(moveStatus(list, 'saved', -1).map((s) => s.id)).toEqual(['saved', 'applied', 'screening']);
  });
});
