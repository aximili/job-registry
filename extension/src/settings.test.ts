import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkServerUrl, loadSettings } from './settings.ts';

// The extension's storage in the browser, kept in memory.
function stubStorage(stored: Record<string, unknown>) {
  const get = async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in stored).map((k) => [k, stored[k]]));
  vi.stubGlobal('chrome', { storage: { local: { get } } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('rates the jobs in search results unless you turn it off', async () => {
    stubStorage({});
    expect((await loadSettings()).rateLists).toBe(true);
    stubStorage({ rateLists: false });
    expect((await loadSettings()).rateLists).toBe(false);
  });
});
