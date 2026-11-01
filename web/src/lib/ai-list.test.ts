import { describe, expect, it } from 'vitest';
import { AI_PRESETS, newSavedAi, StrictAiSettings, type AiPresetId, type AiSettings, type SavedAi } from '../../../shared/contracts/index.ts';
import { aiSummary, defaultAiName, deleteBlock, duplicateAi, noKeyYet, presetGroups, removeAi, switchMessage } from './ai-list.ts';

// Three saved AIs, as the user might have them: Bonsai 2 in use.
function three(): AiSettings {
  const bonsai = { ...newSavedAi('llama-server', 'Bonsai 2', []), id: 'bonsai-2' };
  const light = { ...newSavedAi('llama-server', 'Bonsai 2B light', ['bonsai-2']), id: 'bonsai-2b-light' };
  const claude = { ...newSavedAi('anthropic', 'Claude – mine', ['bonsai-2', 'bonsai-2b-light']), id: 'claude-mine' };
  return StrictAiSettings.parse({ active: 'bonsai-2', saved: [bonsai, light, claude] });
}

const one = (ai: AiSettings, id: string): SavedAi => ai.saved.find((s) => s.id === id)!;

describe('duplicateAi', () => {
  it('adds "{name} (copy)" with a new id, straight after the original', () => {
    const before = three();
    const after = duplicateAi(before, 'bonsai-2');
    expect(after.saved.map((s) => s.id)).toEqual(['bonsai-2', 'bonsai-2-copy', 'bonsai-2b-light', 'claude-mine']);
    expect(one(after, 'bonsai-2-copy').name).toBe('Bonsai 2 (copy)');
  });

  it('copies every setting into a separate AI, and keeps the AI in use', () => {
    const before = three();
    before.saved[2]!.tasks.rate = { ...before.saved[2]!.tasks.rate, maxTokens: 999, extra: { top_k: 20 } };
    const after = duplicateAi(before, 'claude-mine');
    const copy = one(after, 'claude-mine-copy');
    const { id: _a, name: _b, ...rest } = copy;
    const { id: _c, name: _d, ...original } = one(before, 'claude-mine');
    expect(rest).toEqual(original);
    // The copy is a copy: changing it leaves the original alone.
    copy.tasks.rate.extra.top_k = 1;
    expect(one(after, 'claude-mine').tasks.rate.extra.top_k).toBe(20);
    // The AI in use stays the same, and the result is a valid AI section.
    expect(after.active).toBe('bonsai-2');
    expect(StrictAiSettings.safeParse(after).success).toBe(true);
    // The input isn't changed.
    expect(before.saved).toHaveLength(3);
  });

  it('touches the settings only: there is nothing in an AI section for a key, so none is copied', () => {
    const after = duplicateAi(three(), 'claude-mine');
    expect(JSON.stringify(one(after, 'claude-mine-copy'))).not.toMatch(/key/i);
  });

  it('gives a second copy a name and id of its own, so both can be saved', () => {
    const twice = duplicateAi(duplicateAi(three(), 'bonsai-2'), 'bonsai-2');
    expect(twice.saved.map((s) => [s.id, s.name])).toEqual([
      ['bonsai-2', 'Bonsai 2'],
      ['bonsai-2-copy-2', 'Bonsai 2 (copy 2)'],
      ['bonsai-2-copy', 'Bonsai 2 (copy)'],
      ['bonsai-2b-light', 'Bonsai 2B light'],
      ['claude-mine', 'Claude – mine'],
    ]);
    const thrice = duplicateAi(twice, 'bonsai-2');
    expect(thrice.saved[1]!.name).toBe('Bonsai 2 (copy 3)');
    // Names are told apart without caring about capitals.
    const shouty = three();
    shouty.saved[1]!.name = 'BONSAI 2 (COPY)';
    expect(duplicateAi(shouty, 'bonsai-2').saved[1]!.name).toBe('Bonsai 2 (copy 2)');
    expect(StrictAiSettings.safeParse(thrice).success).toBe(true);
  });

  it('keeps a long name within 60 characters', () => {
    const ai = three();
    ai.saved[0]!.name = 'B'.repeat(60);
    const copy = duplicateAi(ai, 'bonsai-2').saved[1]!;
    expect(copy.name).toHaveLength(60);
    expect(copy.name.endsWith(' (copy)')).toBe(true);
    expect(StrictAiSettings.safeParse(duplicateAi(ai, 'bonsai-2')).success).toBe(true);
    const second = duplicateAi(duplicateAi(ai, 'bonsai-2'), 'bonsai-2').saved[1]!;
    expect(second.name).toHaveLength(60);
    expect(second.name.endsWith(' (copy 2)')).toBe(true);
  });
});

describe('removeAi and deleteBlock', () => {
  it('removes an AI that is not in use', () => {
    const ai = three();
    expect(deleteBlock(ai, 'claude-mine')).toBeNull();
    expect(removeAi(ai, 'claude-mine').saved.map((s) => s.id)).toEqual(['bonsai-2', 'bonsai-2b-light']);
    expect(ai.saved).toHaveLength(3);
  });

  it('refuses the AI in use, with the sentence to show', () => {
    const ai = three();
    expect(deleteBlock(ai, 'bonsai-2')).toBe('Switch to another AI first.');
    expect(() => removeAi(ai, 'bonsai-2')).toThrow('Switch to another AI first.');
  });

  it('refuses the last AI, with the sentence to show', () => {
    const ai = StrictAiSettings.parse({ active: 'bonsai-2', saved: [three().saved[0]] });
    expect(deleteBlock(ai, 'bonsai-2')).toBe('You need at least one AI.');
    expect(() => removeAi(ai, 'bonsai-2')).toThrow('You need at least one AI.');
  });
});

describe('aiSummary', () => {
  it('is the provider and the model', () => {
    const claude = newSavedAi('anthropic', 'Claude', []);
    expect(aiSummary(claude)).toBe('Claude (Anthropic API) · claude-sonnet-5-5');
  });

  it('says "no model" when there is none', () => {
    const ollama = newSavedAi('ollama', 'Ollama', []);
    expect(aiSummary(ollama)).toBe('Ollama · no model');
    expect(aiSummary({ ...ollama, model: '  ' })).toBe('Ollama · no model');
  });

  it('for Bonsai 2, names the model file it runs, as you typed it', () => {
    const bonsai = newSavedAi('llama-server', 'Bonsai 2', []);
    // The program the app starts: the file after -m.
    expect(aiSummary(bonsai)).toBe('Bonsai 2 (llama-server) · Ternary-Bonsai-2-27B-PQ2_0.gguf');
    // Your own .bat file: the Model file you filled in, or else the .bat file itself.
    const bat = { ...bonsai, managed: { ...bonsai.managed, exe: 'D:\\aitest\\Bonsai-demo\\start_bonsai.bat' } };
    expect(aiSummary(bat)).toBe('Bonsai 2 (llama-server) · start_bonsai.bat');
    expect(aiSummary({ ...bat, model: 'D:\\models\\Bonsai-2B.gguf' })).toBe('Bonsai 2 (llama-server) · Bonsai-2B.gguf');
    // A server you start yourself, with no Model file.
    expect(aiSummary({ ...bonsai, managed: { ...bonsai.managed, enabled: false } })).toBe('Bonsai 2 (llama-server) · no model');
  });
});

describe('presetGroups', () => {
  it('lists the cloud presets first, then the ones on this computer, each in catalogue order', () => {
    const groups = presetGroups();
    expect(groups.map((g) => g.label)).toEqual(['Cloud', 'On this computer']);
    const all = Object.keys(AI_PRESETS) as AiPresetId[];
    expect(groups[0]!.ids).toEqual(all.filter((id) => AI_PRESETS[id].group === 'cloud'));
    expect(groups[1]!.ids).toEqual(all.filter((id) => AI_PRESETS[id].group === 'local'));
    expect(groups[0]!.ids[0]).toBe('anthropic');
    expect(groups[1]!.ids).toEqual(['llama-server', 'ollama', 'lmstudio', 'custom']);
    expect(groups.flatMap((g) => g.ids)).toHaveLength(15);
  });
});

describe('defaultAiName', () => {
  it("is the provider's short name, made unique among your AIs", () => {
    expect(defaultAiName('anthropic', [])).toBe('Claude');
    expect(defaultAiName('kimi', [])).toBe('Kimi');
    expect(defaultAiName('openai', [])).toBe('OpenAI');
    expect(defaultAiName('custom', [])).toBe('My AI server');
    expect(defaultAiName('llama-server', ['Bonsai 2'])).toBe('Bonsai 2 (2)');
    expect(defaultAiName('anthropic', ['Claude', 'claude (2)'])).toBe('Claude (3)');
  });
});

describe('switchMessage', () => {
  it('says which AI is in use now', () => {
    const ai = three();
    expect(switchMessage(one(ai, 'bonsai-2'), one(ai, 'claude-mine'))).toBe('Now using Claude – mine.');
  });

  it('adds the warning when the AI you left may still be answering on the same address', () => {
    const ai = three();
    const bat = { ...one(ai, 'bonsai-2'), managed: { ...one(ai, 'bonsai-2').managed, exe: 'start_bonsai.bat' } };
    const light = { ...one(ai, 'bonsai-2b-light'), managed: { ...one(ai, 'bonsai-2b-light').managed, enabled: false } };
    expect(switchMessage(bat, light)).toBe('Now using Bonsai 2B light. Bonsai 2 may still be running on 127.0.0.1:8080. Close its window if it is.');
  });
});

describe('noKeyYet', () => {
  it('is true for an AI that needs a key and has none', () => {
    const ai = three();
    expect(noKeyYet(one(ai, 'claude-mine'), [])).toBe(true);
    expect(noKeyYet(one(ai, 'claude-mine'), ['bonsai-2'])).toBe(true);
  });

  it('is false with a key, for an AI that needs none, or while the keys are not known yet', () => {
    const ai = three();
    expect(noKeyYet(one(ai, 'claude-mine'), ['claude-mine'])).toBe(false);
    expect(noKeyYet(one(ai, 'bonsai-2'), [])).toBe(false);
    // "Another OpenAI-style server" may need one or not: it isn't flagged.
    expect(noKeyYet(newSavedAi('custom', 'My AI server', []), [])).toBe(false);
    expect(noKeyYet(one(ai, 'claude-mine'), null)).toBe(false);
  });
});

describe('switchMessage, to an AI with no key', () => {
  it('says so, so the first task failing is no surprise', () => {
    const ai = three();
    expect(switchMessage(one(ai, 'bonsai-2'), one(ai, 'claude-mine'), { noKey: true })).toBe(
      'Now using Claude – mine. No API key yet: add one in Settings → AI.',
    );
    expect(switchMessage(null, one(ai, 'claude-mine'), { noKey: true })).toBe('Now using Claude – mine. No API key yet: add one in Settings → AI.');
    expect(switchMessage(null, one(ai, 'bonsai-2'))).toBe('Now using Bonsai 2.');
  });
});

