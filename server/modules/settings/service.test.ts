import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { activeAi, DEFAULT_SETTINGS, DEFAULT_STATUSES, type SavedAi } from '../../../shared/contracts/index.ts';
import { ValidationError } from '../../core/errors.ts';
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
    expect(settings.updateSecrets({ emailPassword: 'abcd efgh ijkl mnop' })).toEqual({ emailPassword: true, aiKeys: [] });
    expect(settings.secrets()).toEqual({ emailPassword: true, aiKeys: [] });
    expect(settings.emailPassword()).toBe('abcdefghijklmnop');
    expect(JSON.parse(readFileSync(secretsFile, 'utf8'))).toEqual({ emailPassword: 'abcdefghijklmnop', aiKeys: {} });
    expect(readFileSync(file, 'utf8')).not.toContain('abcd');

    expect(settings.updateSecrets({ emailPassword: null })).toEqual({ emailPassword: false, aiKeys: [] });
    expect(settings.emailPassword()).toBeNull();
    settings.updateSecrets({ emailPassword: 'x' });
    expect(settings.updateSecrets({ emailPassword: '   ' })).toEqual({ emailPassword: false, aiKeys: [] });
    expect(settings.emailPassword()).toBeNull();
  });

  it('reads a hand-edited secrets file each time', () => {
    const { secretsFile, settings } = secretsSetup();
    writeSettings(secretsFile, '\uFEFF{ "emailPassword": "fromnotepad" }');
    expect(settings.emailPassword()).toBe('fromnotepad');
    expect(settings.secrets()).toEqual({ emailPassword: true, aiKeys: [] });
  });

  it('a missing secrets file means no password, and is not created by reading', () => {
    const { secretsFile, settings } = secretsSetup();
    expect(settings.secrets()).toEqual({ emailPassword: false, aiKeys: [] });
    expect(settings.emailPassword()).toBeNull();
    expect(settings.aiKey('bonsai-2')).toBeNull();
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
    expect(message).toBe(`${secretsFile} isn't valid JSON. Check the quotes around the password and API keys.`);
    expect(message).not.toContain('abcd');
  });

  it('saving a password tells the app, without the password', () => {
    const { settings, events } = secretsSetup();
    settings.updateSecrets({ emailPassword: 'abcdefghijklmnop' });
    expect(events).toEqual([{ keys: ['secrets'] }]);
  });
});

describe('settings service: saved AIs and their API keys', () => {
  const bonsai = activeAi(DEFAULT_SETTINGS.ai);
  const ai = (id: string, name = id): SavedAi => ({ ...bonsai, id, name, preset: 'custom', baseUrl: 'https://api.example.com/v1' });

  // Settings with Bonsai 2 in use and the given AIs saved too.
  function aisSetup(...others: SavedAi[]) {
    const s = setup();
    const secretsFile = join(dirname(s.file), 'secrets.json');
    writeSettings(s.file, JSON.stringify({ ai: { active: 'bonsai-2', saved: [bonsai, ...others] } }));
    return { ...s, secretsFile, settings: createSettingsService({ file: s.file, secretsFile, bus: s.bus }) };
  }
  const keysOnDisk = (secretsFile: string) => JSON.parse(readFileSync(secretsFile, 'utf8')).aiKeys;

  it('keeps an API key in secrets.json by AI id, without the spaces or newline you pasted', () => {
    const { file, secretsFile, settings, events } = aisSetup(ai('claude-mine'));
    expect(settings.updateSecrets({ aiKeys: { 'claude-mine': '  sk-ant-123\n' } })).toEqual({ emailPassword: false, aiKeys: ['claude-mine'] });
    expect(settings.secrets()).toEqual({ emailPassword: false, aiKeys: ['claude-mine'] });
    expect(settings.aiKey('claude-mine')).toBe('sk-ant-123');
    expect(keysOnDisk(secretsFile)).toEqual({ 'claude-mine': 'sk-ant-123' });
    expect(settings.aiKey('bonsai-2')).toBeNull();
    // The AI hears of it ("aiKeys"), without the key: a new key may fix the
    // problem the pill shows. Never "secrets": the Gmail timer must not restart.
    expect(events).toEqual([{ keys: ['aiKeys'] }]);
    expect(readFileSync(file, 'utf8')).not.toContain('sk-ant-123');
  });

  it('says "aiKeys" changed only when a key really changed', () => {
    const { settings, events } = aisSetup(ai('claude-mine'), ai('claude-wife'));
    settings.updateSecrets({ aiKeys: { 'claude-mine': 'sk-ant-123' } });
    // The same key again (spaces aside), or removing a key that isn't there, changes nothing.
    settings.updateSecrets({ aiKeys: { 'claude-mine': ' sk-ant-123 ' } });
    settings.updateSecrets({ aiKeys: { 'claude-wife': null } });
    expect(events).toEqual([{ keys: ['aiKeys'] }]);
    settings.updateSecrets({ aiKeys: { 'claude-mine': null } });
    expect(events).toEqual([{ keys: ['aiKeys'] }, { keys: ['aiKeys'] }]);
    // A new password and a new key together: one event that names both.
    settings.updateSecrets({ emailPassword: 'abcdefgh', aiKeys: { 'claude-wife': 'sk-ant-456' } });
    expect(events.at(-1)).toEqual({ keys: ['secrets', 'aiKeys'] });
  });

  it('null or blank removes a key', () => {
    const { settings } = aisSetup(ai('claude-mine'));
    settings.updateSecrets({ aiKeys: { 'claude-mine': 'sk-ant-123' } });
    expect(settings.updateSecrets({ aiKeys: { 'claude-mine': null } })).toEqual({ emailPassword: false, aiKeys: [] });
    expect(settings.aiKey('claude-mine')).toBeNull();
    settings.updateSecrets({ aiKeys: { 'claude-mine': 'sk-ant-123' } });
    expect(settings.updateSecrets({ aiKeys: { 'claude-mine': '  ' } })).toEqual({ emailPassword: false, aiKeys: [] });
    expect(settings.aiKey('claude-mine')).toBeNull();
  });

  it('only a change to the app password says secrets changed, so the Gmail timer restarts only then', () => {
    const { settings, events } = aisSetup(ai('claude-mine'));
    // Gmail listens only for "secrets".
    const forGmail = () => events.filter((e) => (e as { keys: string[] }).keys.includes('secrets'));
    settings.updateSecrets({ aiKeys: { 'claude-mine': 'sk-ant-123' } });
    settings.updateSecrets({ aiKeys: { 'claude-mine': null } });
    expect(forGmail()).toEqual([]);
    settings.updateSecrets({ emailPassword: 'abcd efgh' });
    expect(forGmail()).toEqual([{ keys: ['secrets'] }]);
    // The same password again, or a key alongside it, changes nothing for Gmail.
    settings.updateSecrets({ emailPassword: 'abcdefgh', aiKeys: { 'claude-mine': 'sk-ant-123' } });
    expect(forGmail()).toEqual([{ keys: ['secrets'] }]);
    settings.updateSecrets({ emailPassword: null });
    expect(forGmail()).toEqual([{ keys: ['secrets'] }, { keys: ['secrets'] }]);
  });

  it('saving the app password leaves the API keys alone, and the other way round', () => {
    const { settings } = aisSetup(ai('claude-mine'), ai('claude-wife'));
    settings.updateSecrets({ aiKeys: { 'claude-mine': 'sk-ant-123', 'claude-wife': 'sk-ant-456' } });
    expect(settings.updateSecrets({ emailPassword: 'abcd efgh' })).toEqual({ emailPassword: true, aiKeys: ['claude-mine', 'claude-wife'] });
    expect(settings.aiKey('claude-mine')).toBe('sk-ant-123');
    // Only the keys you send change.
    settings.updateSecrets({ aiKeys: { 'claude-wife': null } });
    expect(settings.aiKey('claude-mine')).toBe('sk-ant-123');
    expect(settings.emailPassword()).toBe('abcdefgh');
    expect(settings.secrets()).toEqual({ emailPassword: true, aiKeys: ['claude-mine'] });
  });

  it('refuses a key for an AI that is not saved, so it can never turn up on a new AI later', () => {
    const { secretsFile, settings, events } = aisSetup();
    expect(() => settings.updateSecrets({ aiKeys: { claude: 'sk-ant-123' } })).toThrow(ValidationError);
    expect(() => readFileSync(secretsFile)).toThrow();
    expect(events).toEqual([]);
    let message = '';
    try {
      settings.updateSecrets({ aiKeys: { claude: 'sk-ant-123' } });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain('sk-ant-123');
  });

  it('a key sent where an AI id goes is never quoted in the message', () => {
    const { secretsFile, settings } = aisSetup(ai('claude-mine'));
    // Each request must be refused; the message it gives is returned.
    const refusal = (req: unknown): string => {
      try {
        settings.updateSecrets(req as never);
      } catch (err) {
        expect(err, JSON.stringify(req)).toBeInstanceOf(ValidationError);
        return (err as Error).message;
      }
      throw new Error(`${JSON.stringify(req)} was accepted`);
    };
    expect(refusal({ aiKeys: { 'sk-ant-API03_Secret': 'claude-mine' } })).toBe("An API key was sent for an AI id that isn't valid.");
    // A DeepSeek or Qwen key is sk- and 32 lower-case hex characters, which is a valid id.
    const hexKey = 'sk-0123456789abcdef0123456789abcdef';
    expect(refusal({ aiKeys: { [hexKey]: 'claude-mine' } })).toBe("There's no saved AI for this key. Save the AI first, then its key.");
    // A key that isn't text, or a name it doesn't know: the message names only the part.
    for (const req of [{ aiKeys: { 'claude-mine': 12345 } }, { 'sk-ant-API03_Secret': 'x' }]) {
      expect(refusal(req), JSON.stringify(req)).not.toMatch(/sk-ant|12345/);
    }
    expect(() => readFileSync(secretsFile)).toThrow();
  });

  it('a key can be saved for the AIs the app knows, the same list the status gives', () => {
    const { file, settings } = aisSetup(ai('claude-mine'));
    // An AI added to settings.json by hand while the app runs isn't known until the next save.
    writeSettings(file, JSON.stringify({ ai: { active: 'bonsai-2', saved: [bonsai, ai('claude-mine'), ai('claude-new')] } }));
    expect(() => settings.updateSecrets({ aiKeys: { 'claude-new': 'sk-ant-789' } })).toThrow(ValidationError);
    expect(settings.secrets().aiKeys).toEqual([]);
    // One removed by hand is still known, so its key is saved and listed, until the next save drops it.
    writeSettings(file, JSON.stringify({ ai: { active: 'bonsai-2', saved: [bonsai] } }));
    expect(settings.updateSecrets({ aiKeys: { 'claude-mine': 'sk-ant-123' } }).aiKeys).toEqual(['claude-mine']);
    expect(settings.secrets().aiKeys).toEqual(['claude-mine']);
  });

  it('deleting an AI deletes its key, and a new AI with the same id does not get it back', () => {
    const { secretsFile, settings, events } = aisSetup(ai('claude', 'Claude'));
    settings.updateSecrets({ aiKeys: { claude: 'sk-ant-123' }, emailPassword: 'abcdefgh' });
    events.length = 0;

    settings.update({ ai: { active: 'bonsai-2', saved: [bonsai] } });
    expect(settings.aiKey('claude')).toBeNull();
    expect(keysOnDisk(secretsFile)).toEqual({});
    expect(settings.emailPassword()).toBe('abcdefgh');
    expect(events).toEqual([{ keys: ['ai'] }]);

    settings.update({ ai: { active: 'bonsai-2', saved: [bonsai, ai('claude', 'Claude')] } });
    expect(settings.aiKey('claude')).toBeNull();
    expect(settings.secrets()).toEqual({ emailPassword: true, aiKeys: [] });
  });

  it('an AI removed from settings.json by hand loses its key at the next save, even if it comes back in that save', () => {
    const { file, settings } = aisSetup(ai('claude', 'Claude'));
    settings.updateSecrets({ aiKeys: { claude: 'sk-ant-123' } });
    writeSettings(file, JSON.stringify({ ai: { active: 'bonsai-2', saved: [bonsai] } }));
    settings.update({ ai: { active: 'bonsai-2', saved: [bonsai, ai('claude', 'Claude')] } });
    expect(settings.aiKey('claude')).toBeNull();
  });

  it('saving AI settings keeps the keys of AIs still saved', () => {
    const { settings, events } = aisSetup(ai('claude-mine'));
    settings.updateSecrets({ aiKeys: { 'claude-mine': 'sk-ant-123' } });
    events.length = 0;
    settings.update({ ai: { active: 'bonsai-2', saved: [bonsai, { ...ai('claude-mine'), name: 'Claude – mine' }] } });
    expect(settings.aiKey('claude-mine')).toBe('sk-ant-123');
    expect(events).toEqual([{ keys: ['ai'] }]);
  });

  it("changing an AI's provider deletes its key, so a key only ever goes to the provider it was saved for", () => {
    const anthropic = { ...ai('claude-mine'), preset: 'anthropic' as const, baseUrl: 'https://api.anthropic.com/v1' };
    const { secretsFile, settings } = aisSetup(anthropic, ai('other'));
    settings.updateSecrets({ aiKeys: { 'claude-mine': 'sk-ant-123', other: 'sk-other-456' } });

    // The same AI, now OpenAI: its Anthropic key goes; another AI's key stays.
    settings.update({
      ai: { active: 'bonsai-2', saved: [bonsai, { ...anthropic, preset: 'openai', baseUrl: 'https://api.openai.com/v1' }, ai('other')] },
    });
    expect(settings.aiKey('claude-mine')).toBeNull();
    expect(keysOnDisk(secretsFile)).toEqual({ other: 'sk-other-456' });
    expect(settings.secrets().aiKeys).toEqual(['other']);

    // A new key for its new provider is kept after the next save.
    settings.updateSecrets({ aiKeys: { 'claude-mine': 'sk-openai-789' } });
    settings.update({
      ai: { active: 'bonsai-2', saved: [bonsai, { ...anthropic, name: 'Renamed', preset: 'openai', baseUrl: 'https://api.openai.com/v1' }, ai('other')] },
    });
    expect(settings.aiKey('claude-mine')).toBe('sk-openai-789');
  });

  it('saving other settings never needs the secrets file', () => {
    const { secretsFile, settings } = aisSetup();
    writeSettings(secretsFile, '{ broken');
    expect(settings.update({ server: { port: 5001 } }).server.port).toBe(5001);
  });

  it('useAi switches the AI in use, saves it, and tells the app', () => {
    const { file, settings, events } = aisSetup(ai('claude-mine'));
    const next = settings.useAi('claude-mine');
    expect(next.ai.active).toBe('claude-mine');
    expect(activeAi(settings.get().ai).id).toBe('claude-mine');
    expect(JSON.parse(readFileSync(file, 'utf8')).ai.active).toBe('claude-mine');
    expect(events).toEqual([{ keys: ['ai'] }]);
  });

  it('useAi refuses an AI that is not saved, and changes nothing', () => {
    const { file, settings, events } = aisSetup(ai('claude-mine'));
    const before = readFileSync(file, 'utf8');
    expect(() => settings.useAi('nope')).toThrow(ValidationError);
    expect(() => settings.useAi('nope')).toThrow("There's no saved AI with the id 'nope'.");
    expect(settings.get().ai.active).toBe('bonsai-2');
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(events).toEqual([]);
  });

  it('useAi keeps hand edits made to the file while the app runs', () => {
    const { file, settings } = aisSetup(ai('claude-mine'));
    writeSettings(file, JSON.stringify({ server: { port: 5005 }, ai: { active: 'bonsai-2', saved: [bonsai, ai('claude-mine')] } }));
    expect(settings.useAi('claude-mine').server.port).toBe(5005);
  });

  it('useWriter picks the AI that writes your documents, saves it, and tells the app', () => {
    const { file, settings, events } = aisSetup(ai('claude-mine'));
    const next = settings.useWriter('claude-mine');
    expect(next.ai.writer).toBe('claude-mine');
    // The AI in use stays as it was.
    expect(next.ai.active).toBe('bonsai-2');
    expect(settings.get().ai.writer).toBe('claude-mine');
    expect(JSON.parse(readFileSync(file, 'utf8')).ai.writer).toBe('claude-mine');
    expect(events).toEqual([{ keys: ['ai'] }]);
  });

  it('useWriter(null) goes back to the AI in use', () => {
    const { file, settings, events } = aisSetup(ai('claude-mine'));
    settings.useWriter('claude-mine');
    events.length = 0;
    expect(settings.useWriter(null).ai.writer).toBeNull();
    expect(JSON.parse(readFileSync(file, 'utf8')).ai.writer).toBeNull();
    expect(events).toEqual([{ keys: ['ai'] }]);
  });

  it('useWriter refuses an AI that is not saved, without quoting the id, and changes nothing', () => {
    const { file, settings, events } = aisSetup(ai('claude-mine'));
    settings.useWriter('claude-mine');
    events.length = 0;
    const before = readFileSync(file, 'utf8');
    expect(() => settings.useWriter('nope')).toThrow(ValidationError);
    let message = '';
    try {
      settings.useWriter('nope');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe("There's no saved AI with that id.");
    expect(message).not.toContain('nope');
    expect(settings.get().ai.writer).toBe('claude-mine');
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(events).toEqual([]);
  });

  it('useWriter keeps hand edits made to the file while the app runs, and refuses an AI removed by hand', () => {
    const { file, settings } = aisSetup(ai('claude-mine'));
    writeSettings(file, JSON.stringify({ server: { port: 5005 }, ai: { active: 'bonsai-2', saved: [bonsai, ai('claude-mine')] } }));
    expect(settings.useWriter('claude-mine').server.port).toBe(5005);
    writeSettings(file, JSON.stringify({ ai: { active: 'bonsai-2', writer: 'claude-mine', saved: [bonsai] } }));
    expect(() => settings.useWriter('claude-mine')).toThrow("There's no saved AI with that id.");
  });

  it('deleting the writing AI means the AI in use writes, so a new AI with the same id never writes by accident', () => {
    const { file, settings, events } = aisSetup(ai('claude-mine'));
    settings.useWriter('claude-mine');
    events.length = 0;
    expect(settings.update({ ai: { active: 'bonsai-2', writer: 'claude-mine', saved: [bonsai] } }).ai.writer).toBeNull();
    expect(JSON.parse(readFileSync(file, 'utf8')).ai.writer).toBeNull();
    expect(events).toEqual([{ keys: ['ai'] }]);
    // The same id comes back later: it isn't the writer.
    expect(settings.update({ ai: { active: 'bonsai-2', saved: [bonsai, ai('claude-mine')] } }).ai.writer).toBeNull();
  });

  it('a save of the AIs that leaves the writer out keeps the saved one; only a writer sent (an id or null) changes it', () => {
    const { file, settings } = aisSetup(ai('claude-mine'));
    settings.useWriter('claude-mine');
    expect(settings.update({ ai: { active: 'bonsai-2', saved: [bonsai, ai('claude-mine')] } }).ai.writer).toBe('claude-mine');
    expect(JSON.parse(readFileSync(file, 'utf8')).ai.writer).toBe('claude-mine');
    // Kept from the file, as you may have edited it by hand.
    writeSettings(file, JSON.stringify({ ai: { active: 'bonsai-2', writer: 'bonsai-2', saved: [bonsai, ai('claude-mine')] } }));
    expect(settings.update({ ai: { active: 'bonsai-2', saved: [bonsai, ai('claude-mine')] } }).ai.writer).toBe('bonsai-2');
    expect(settings.update({ ai: { active: 'bonsai-2', writer: 'claude-mine', saved: [bonsai, ai('claude-mine')] } }).ai.writer).toBe('claude-mine');
    expect(settings.update({ ai: { active: 'bonsai-2', writer: null, saved: [bonsai, ai('claude-mine')] } }).ai.writer).toBeNull();
    // A writer kept, but deleted by this save, is none.
    settings.useWriter('claude-mine');
    expect(settings.update({ ai: { active: 'bonsai-2', saved: [bonsai] } }).ai.writer).toBeNull();
  });

  it('a save whose writer names no saved AI saves none', () => {
    const { file, settings } = aisSetup(ai('claude-mine'));
    expect(settings.update({ ai: { active: 'bonsai-2', writer: 'claude-gone', saved: [bonsai, ai('claude-mine')] } }).ai.writer).toBeNull();
    expect(JSON.parse(readFileSync(file, 'utf8')).ai.writer).toBeNull();
    // One that is saved is kept.
    expect(settings.update({ ai: { active: 'bonsai-2', writer: 'claude-mine', saved: [bonsai, ai('claude-mine')] } }).ai.writer).toBe('claude-mine');
    // Saving another section leaves the writer alone.
    expect(settings.update({ server: { port: 5001 } }).ai.writer).toBe('claude-mine');
  });

  it('a writer removed from settings.json by hand still loads, and the next save of any setting clears it', () => {
    const { file, bus, settings } = aisSetup(ai('claude-mine'));
    writeSettings(file, JSON.stringify({ ai: { active: 'bonsai-2', writer: 'claude-gone', saved: [bonsai, ai('claude-mine')] } }));
    expect(createSettingsService({ file, bus }).get().ai.writer).toBe('claude-gone');
    expect(settings.update({ server: { port: 5001 } }).ai.writer).toBeNull();
    expect(JSON.parse(readFileSync(file, 'utf8')).ai.writer).toBeNull();
  });

  it('the settings never hold a key', () => {
    const { settings } = aisSetup(ai('claude-mine'));
    settings.updateSecrets({ aiKeys: { 'claude-mine': 'sk-ant-123' } });
    settings.useAi('claude-mine');
    expect(JSON.stringify(settings.get())).not.toContain('sk-ant-123');
    expect(JSON.stringify(settings.secrets())).not.toContain('sk-ant-123');
  });

  it('a hand-edited secrets file with a mistake never shows a key in its message', () => {
    const { secretsFile, settings } = aisSetup(ai('claude-mine'));
    for (const broken of [
      // The key and the id swapped round, and a key pasted as a name of its own.
      '{ "aiKeys": { "sk-ant-API03_secret": "claude-mine" } }',
      '{ "sk-ant-API03_secret": "claude-mine" }',
      '{ "aiKeys": { "claude-mine": 12345 } }',
    ]) {
      writeSettings(secretsFile, broken);
      let message = '';
      try {
        settings.aiKey('claude-mine');
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, broken).toMatch(/secrets\.json has a problem/);
      expect(message, broken).not.toContain('sk-ant');
      expect(message, broken).not.toContain('12345');
    }
  });

  it('lists only the saved AIs that have a key, even with a key left behind by a hand edit', () => {
    const { secretsFile, settings } = aisSetup(ai('claude-mine'));
    writeSettings(secretsFile, JSON.stringify({ aiKeys: { 'claude-mine': 'sk-ant-123', 'claude-gone': 'sk-ant-456' } }));
    expect(settings.secrets()).toEqual({ emailPassword: false, aiKeys: ['claude-mine'] });
  });

  it('reads a hand-edited key each time, trimmed', () => {
    const { secretsFile, settings } = aisSetup(ai('claude-mine'));
    writeSettings(secretsFile, '{ "aiKeys": { "claude-mine": " sk-ant-from-notepad\\n" } }');
    expect(settings.aiKey('claude-mine')).toBe('sk-ant-from-notepad');
    expect(settings.aiKey('constructor')).toBeNull();
    expect(settings.secrets()).toEqual({ emailPassword: false, aiKeys: ['claude-mine'] });
    // A blank key is no key.
    writeSettings(secretsFile, '{ "aiKeys": { "claude-mine": "  " } }');
    expect(settings.aiKey('claude-mine')).toBeNull();
    expect(settings.secrets()).toEqual({ emailPassword: false, aiKeys: [] });
  });
});
