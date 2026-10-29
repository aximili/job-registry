import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_STATUSES } from '../../../shared/contracts/index.ts';
import { createEventBus } from '../../core/events.ts';
import { createSettingsService } from './service.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'jr-settings-'));
  dirs.push(dir);
  const file = join(dir, 'config', 'settings.json');
  const bus = createEventBus(pino({ level: 'silent' }));
  const events: unknown[] = [];
  bus.on('settings.changed', (p) => events.push(p));
  return { file, bus, events };
}

function writeSettings(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

const [saved, applied] = DEFAULT_STATUSES;

describe('settings service', () => {
  it('creates settings.json with defaults when it is missing', () => {
    const { file, bus } = setup();
    const settings = createSettingsService({ file, bus });
    expect(settings.get()).toEqual(DEFAULT_SETTINGS);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(DEFAULT_SETTINGS);
  });

  it('reads an existing file and fills missing keys with defaults', () => {
    const { file, bus } = setup();
    writeSettings(file, JSON.stringify({ server: { port: 5000 } }));
    const settings = createSettingsService({ file, bus });
    expect(settings.get().server.port).toBe(5000);
    expect(settings.get().backups).toEqual({ dir: 'data/backups', keep: 14 });
    expect(settings.get().statuses).toHaveLength(11);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ server: { port: 5000 } });
  });

  it('reads a file saved with a byte-order mark, as Windows Notepad does', () => {
    const { file, bus } = setup();
    writeSettings(file, `\uFEFF${JSON.stringify({ server: { port: 5002 } })}`);
    expect(createSettingsService({ file, bus }).get().server.port).toBe(5002);
  });

  it('refuses invalid JSON, names the file, and leaves it untouched', () => {
    const { file, bus } = setup();
    const broken = '{ "server": { "port": 4777 }, }';
    writeSettings(file, broken);
    expect(() => createSettingsService({ file, bus })).toThrow(/settings\.json isn't valid JSON/);
    expect(readFileSync(file, 'utf8')).toBe(broken);
  });

  it('refuses duplicate status ids on load and on update', () => {
    const { file, bus } = setup();
    const dupes = JSON.stringify({ statuses: [applied, applied] });
    writeSettings(file, dupes);
    expect(() => createSettingsService({ file, bus })).toThrow("Status id 'applied' is used twice.");
    expect(readFileSync(file, 'utf8')).toBe(dupes);

    writeSettings(file, '{}');
    const settings = createSettingsService({ file, bus });
    expect(() => settings.update({ statuses: [saved!, saved!] })).toThrow("Status id 'saved' is used twice.");
  });

  it('update merges sections, writes the file, and emits settings.changed with the changed keys', () => {
    const { file, bus, events } = setup();
    const settings = createSettingsService({ file, bus });
    const next = settings.update({ server: { port: 5001 } });
    expect(next.server.port).toBe(5001);
    expect(next.statuses).toEqual(DEFAULT_SETTINGS.statuses);
    expect(JSON.parse(readFileSync(file, 'utf8')).server.port).toBe(5001);
    expect(events).toEqual([{ keys: ['server'] }]);
  });

  it('statuses() returns statuses sorted by order', () => {
    const { file, bus } = setup();
    writeSettings(file, JSON.stringify({ statuses: [{ ...applied, order: 5 }, { ...saved, order: 50 }] }));
    expect(
      createSettingsService({ file, bus })
        .statuses()
        .map((s) => s.id),
    ).toEqual(['applied', 'saved']);
  });
});

describe('settings service: review fixes', () => {
  it('update keeps hand edits made to the file while the app runs', () => {
    const { file, bus } = setup();
    const settings = createSettingsService({ file, bus });
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    onDisk.statuses[0].label = 'Shortlisted';
    writeSettings(file, JSON.stringify(onDisk));
    const next = settings.update({ server: { port: 5001 } });
    expect(next.statuses[0]?.label).toBe('Shortlisted');
    expect(JSON.parse(readFileSync(file, 'utf8')).statuses[0].label).toBe('Shortlisted');
  });

  it('update refuses when the file has been broken by hand, and leaves it alone', () => {
    const { file, bus } = setup();
    const settings = createSettingsService({ file, bus });
    writeSettings(file, '{ broken');
    expect(() => settings.update({ server: { port: 5001 } })).toThrow(/settings\.json isn't valid JSON/);
    expect(readFileSync(file, 'utf8')).toBe('{ broken');
  });

  it('refuses unknown keys such as a misspelt section', () => {
    const { file, bus } = setup();
    const typo = JSON.stringify({ backup: { dir: 'D:/OneDrive/backups' } });
    writeSettings(file, typo);
    expect(() => createSettingsService({ file, bus })).toThrow(/settings\.json has a problem:[\s\S]*backup/);
    expect(readFileSync(file, 'utf8')).toBe(typo);
  });
});

describe('settings service: the app password', () => {
  function secretsSetup() {
    const s = setup();
    const secretsFile = join(dirname(s.file), 'secrets.json');
    return { ...s, secretsFile, settings: createSettingsService({ file: s.file, secretsFile, bus: s.bus }) };
  }

  it('keeps the app password in secrets.json, never in settings.json', () => {
    const { file, secretsFile, settings } = secretsSetup();
    expect(settings.updateSecrets({ emailPassword: 'abcd efgh ijkl mnop' })).toEqual({ emailPassword: true });
    expect(settings.secrets()).toEqual({ emailPassword: true });
    expect(settings.emailPassword()).toBe('abcdefghijklmnop');
    expect(JSON.parse(readFileSync(secretsFile, 'utf8'))).toEqual({ emailPassword: 'abcdefghijklmnop' });
    expect(readFileSync(file, 'utf8')).not.toContain('abcd');

    expect(settings.updateSecrets({ emailPassword: null })).toEqual({ emailPassword: false });
    expect(settings.emailPassword()).toBeNull();
    settings.updateSecrets({ emailPassword: 'x' });
    expect(settings.updateSecrets({ emailPassword: '   ' })).toEqual({ emailPassword: false });
    expect(settings.emailPassword()).toBeNull();
  });

  it('reads a hand-edited secrets file each time', () => {
    const { secretsFile, settings } = secretsSetup();
    writeSettings(secretsFile, '\uFEFF{ "emailPassword": "fromnotepad" }');
    expect(settings.emailPassword()).toBe('fromnotepad');
    expect(settings.secrets()).toEqual({ emailPassword: true });
  });

  it('a missing secrets file means no password, and is not created by reading', () => {
    const { secretsFile, settings } = secretsSetup();
    expect(settings.secrets()).toEqual({ emailPassword: false });
    expect(settings.emailPassword()).toBeNull();
    expect(() => readFileSync(secretsFile)).toThrow();
  });

  it('a broken secrets file names the file', () => {
    const { secretsFile, settings } = secretsSetup();
    writeSettings(secretsFile, '{');
    expect(() => settings.emailPassword()).toThrow(/secrets\.json/);
  });

  it('a broken secrets file never shows the password in its message', () => {
    const { secretsFile, settings } = secretsSetup();
    writeSettings(secretsFile, '{ "emailPassword": abcd efgh ijkl mnop }');
    let message = '';
    try {
      settings.secrets();
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe(`${secretsFile} isn't valid JSON. Check the quotes around the password.`);
    expect(message).not.toContain('abcd');
  });

  it('saving a password tells the app, without the password', () => {
    const { settings, events } = secretsSetup();
    settings.updateSecrets({ emailPassword: 'abcdefghijklmnop' });
    expect(events).toEqual([{ keys: ['secrets'] }]);
  });
});
