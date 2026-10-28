import { describe, expect, it } from 'vitest';
import { checkServerUrl } from './settings.ts';

describe('extension settings', () => {
  it('accepts the app address, with or without a slash at the end', () => {
    expect(checkServerUrl('http://127.0.0.1:4777')).toEqual({ ok: true, value: 'http://127.0.0.1:4777' });
    expect(checkServerUrl('  http://localhost:5000/ ')).toEqual({ ok: true, value: 'http://localhost:5000' });
  });

  it('refuses anything that is not this computer, with a plain reason', () => {
    expect(checkServerUrl('127.0.0.1:4777')).toEqual({ ok: false, error: 'Start the address with http://, for example http://127.0.0.1:4777' });
    expect(checkServerUrl('https://example.com')).toEqual({
      ok: false,
      error: 'Job Registry runs on this computer, so the address must be http://127.0.0.1 or http://localhost.',
    });
    expect(checkServerUrl('')).toMatchObject({ ok: false });
  });
});
