// The Windows scripts can't run here, so these checks pin the things that
// would break them on Windows.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const SCRIPTS = ['setup.bat', 'start.bat', 'stop.bat', 'scripts/setup.ps1'];

describe('Windows scripts', () => {
  it.each(SCRIPTS)('%s is plain ASCII with Windows line endings', (path) => {
    const text = read(path);
    expect([...text].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('stop.bat sends a JSON body, because PowerShell 5.1 otherwise sends a form type the server refuses', () => {
    const stop = read('stop.bat');
    expect(stop).toContain("-ContentType 'application/json'");
    expect(stop).toContain("-Body '{}'");
  });

  it('stop.bat only says "wasn\'t running" when nothing answered, and pauses so you can read it', () => {
    const stop = read('stop.bat');
    expect(stop).toContain('$_.Exception.Response');
    expect(stop).toMatch(/timeout \/t \d+ >nul/);
  });
});
