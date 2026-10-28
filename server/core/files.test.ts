import { describe, expect, it, vi } from 'vitest';
import { replaceFile } from './files.ts';

const fsError = (code: string) => Object.assign(new Error(code), { code });

describe('replaceFile', () => {
  it('tries again when Windows briefly locks the file (antivirus, the search indexer)', () => {
    const rename = vi.fn().mockImplementationOnce(() => {
      throw fsError('EPERM');
    }).mockImplementationOnce(() => {
      throw fsError('EBUSY');
    });
    const wait = vi.fn();
    replaceFile('a.tmp', 'a', { rename, wait });
    expect(rename).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('gives up after a few tries and reports the last error', () => {
    const rename = vi.fn(() => {
      throw fsError('EACCES');
    });
    expect(() => replaceFile('a.tmp', 'a', { rename, wait: () => {} })).toThrow('EACCES');
    expect(rename).toHaveBeenCalledTimes(5);
  });

  it('does not retry other errors', () => {
    const rename = vi.fn(() => {
      throw fsError('ENOENT');
    });
    expect(() => replaceFile('a.tmp', 'a', { rename, wait: () => {} })).toThrow('ENOENT');
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
