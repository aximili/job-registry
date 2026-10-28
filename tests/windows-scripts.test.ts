// The Windows scripts can't run here, so these checks pin the things that
// would break them on Windows.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const SCRIPTS = ['setup.bat', 'start.bat', 'stop.bat', 'download-ai.bat', 'scripts/setup.ps1', 'scripts/download-ai.ps1'];

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

  it('setup.ps1 stops before touching packages when the app is running', () => {
    const setup = read('scripts/setup.ps1');
    const check = setup.indexOf('/api/v1/health');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(setup.indexOf('& npm ci'));
    expect(setup).toContain('stop.bat');
  });

  it('setup.ps1 treats paths literally, so a folder name with [ ] in it works', () => {
    const setup = read('scripts/setup.ps1');
    // PowerShell reads [ ] in a -Path as a wildcard; -LiteralPath doesn't.
    for (const cmd of ['Set-Location', 'Test-Path', 'Copy-Item']) {
      for (const line of setup.split('\r\n').filter((l) => l.includes(`${cmd} `))) {
        expect(line).toContain(`${cmd} -LiteralPath`);
      }
    }
    expect(setup).not.toMatch(/New-Item[^\r\n]*-Path/);
  });

  it('download-ai.ps1 fetches the pinned CUDA 12.4 build and the PQ2_0 model, and checks each file', () => {
    const script = read('scripts/download-ai.ps1');
    expect(script).toContain('prism-b10777-e3de715');
    expect(script).toContain('llama-prism-b10777-e3de715-bin-win-cuda-12.4-x64.zip');
    expect(script).toContain('cudart-llama-bin-win-cuda-12.4-x64.zip');
    expect(script).toContain('Ternary-Bonsai-2-27B-PQ2_0.gguf');
    for (const sha of [
      'fa5874a1412e251a6efb13f289e97bacbbb4e7fc6714c1836b4fc6c1dc863462',
      '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6',
      '3907dc1658db1f78a9826bf8d5bcb8dc65db0d466388937af57f2294fae62ec1',
    ]) {
      expect(script.toLowerCase()).toContain(sha);
    }
    expect(script).toContain('Get-FileHash');
  });

  it('download-ai.ps1 can carry on after a broken download, and unzips into ai\\llama.cpp', () => {
    const script = read('scripts/download-ai.ps1');
    expect(script).toMatch(/curl\.exe/);
    expect(script).toContain('-C -');
    expect(script).toContain('--fail');
    expect(script).toContain("'llama.cpp'");
    expect(script).toContain('Expand-Archive -LiteralPath');
  });

  it('setup.ps1 offers the AI download, and a failed download does not end setup', () => {
    const setup = read('scripts/setup.ps1');
    expect(setup).toContain('Download the AI now');
    expect(setup).toMatch(/powershell[^\r\n]*-File[^\r\n]*download-ai\.ps1/i);
  });

  it('download-ai.ps1 downloads while the app runs, and only needs it stopped to unpack', () => {
    const script = read('scripts/download-ai.ps1');
    expect(script.indexOf('/api/v1/health')).toBeGreaterThan(script.indexOf('& $curl'));
    expect(script.indexOf('/api/v1/health')).toBeLessThan(script.indexOf('Expand-Archive'));
  });

  it('download-ai.ps1 skips unpacking when nothing new was downloaded and llama-server.exe is there', () => {
    const script = read('scripts/download-ai.ps1');
    expect(script).toMatch(/if \(\$changed -or -not \(Test-Path -LiteralPath \$serverExe\) -or \(\$unpacked -ne \$wanted\)\)/);
    expect(script).toContain('unpacked.txt');
  });

  it('setup.ps1 builds the browser extension after the dashboard', () => {
    const setup = read('scripts/setup.ps1');
    expect(setup).toContain('& npm run ext:build');
    expect(setup.indexOf('& npm run ext:build')).toBeGreaterThan(setup.indexOf('& npm run build'));
  });
});

