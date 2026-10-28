import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api-client.ts';
import { friendlyError } from './errors.ts';

describe('friendlyError', () => {
  it('a network failure says the app may have stopped', () => {
    expect(friendlyError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(
      "Can't reach Job Registry. Check that it's still running, then try again.",
    );
    expect(friendlyError(new TypeError('Failed to fetch'))).toBe("Can't reach Job Registry. Check that it's still running, then try again.");
  });

  it('zod symbols are removed from validation messages', () => {
    const err = new ApiError('validation', 400, '/x/settings.json has a problem:\n✖ A status needs a label.\n  → at statuses[3].label');
    expect(friendlyError(err)).toBe('/x/settings.json has a problem: A status needs a label.');
  });

  it('other errors keep their message, and anything else gets a plain sentence', () => {
    expect(friendlyError(new ApiError('not_found', 404, 'Job 9 not found'))).toBe('Job 9 not found');
    expect(friendlyError(new Error('Oops.'))).toBe('Oops.');
    expect(friendlyError('a string')).toBe('Something went wrong.');
  });
});
