import { describe, expect, it } from 'vitest';
import { AI_PRESETS, AiPresetId, newSavedAi, PRESETS_CHECKED, SavedAi, type AiDialect, type ThinkingMap } from './index.ts';

const CLOUD: AiPresetId[] = ['anthropic', 'openai', 'gemini', 'deepseek', 'kimi', 'zai', 'qwen', 'mistral', 'xai', 'groq', 'openrouter'];
const LOCAL: AiPresetId[] = ['llama-server', 'ollama', 'lmstudio', 'custom'];

// The cloud note, word for word, with each provider's short name.
const cloudNote = (provider: string) =>
  `${provider} sees your profile, the ads you save and rate, and (if email is on) your emails. Each request is billed to this key. Quick marks rate every card on a search page, so they use the most.`;
const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  zai: 'Z.ai',
  qwen: 'Qwen',
  mistral: 'Mistral',
  xai: 'xAI',
  groq: 'Groq',
  openrouter: 'OpenRouter',
};

// The controller's dialect table (provider-research.md), written out here so
// a slip in the catalogue can't hide behind the same slip in the test.
const effort = (field: string, [off, low, medium, high, max]: (string | null)[]): ThinkingMap => {
  const one = (v: string | null) => (v === null ? null : { [field]: v });
  return { off: one(off), low: one(low), medium: one(medium), high: one(high), max: one(max) };
};
// Thinking turned off, or on with an effort (DeepSeek and Z.ai).
const onOrOff = ([low, medium, high, max]: string[]): ThinkingMap => {
  const on = (v: string) => ({ thinking: { type: 'enabled' }, reasoning_effort: v });
  return { off: { thinking: { type: 'disabled' } }, low: on(low), medium: on(medium), high: on(high), max: on(max) };
};
// Claude: always adaptive thinking, with an effort. Never "disabled".
const adaptive = (v: string) => ({ thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: v } });
const openRouter = (v: string) => ({ reasoning: { effort: v } });

const TABLE: [AiPresetId, AiDialect][] = [
  // Claude's connector asks for JSON by schema and sends max_tokens itself.
  [
    'anthropic',
    {
      connector: 'anthropic',
      json: 'schema',
      thinking: {
        off: adaptive('low'),
        low: adaptive('low'),
        medium: adaptive('medium'),
        high: adaptive('high'),
        max: adaptive('max'),
      },
      maxTokens: 'max_tokens',
      temperature: false,
      listModels: true,
    },
  ],
  [
    'openai',
    {
      connector: 'openai',
      json: 'schema',
      thinking: effort('reasoning_effort', ['low', 'low', 'medium', 'high', 'max']),
      maxTokens: 'max_completion_tokens',
      temperature: false,
      listModels: true,
    },
  ],
  [
    'gemini',
    {
      connector: 'openai',
      json: 'schema',
      thinking: effort('reasoning_effort', ['minimal', 'low', 'medium', 'high', 'high']),
      maxTokens: 'max_tokens',
      temperature: true,
      listModels: true,
    },
  ],
  [
    'deepseek',
    {
      connector: 'openai',
      json: 'object',
      thinking: onOrOff(['low', 'high', 'high', 'max']),
      maxTokens: 'max_tokens',
      temperature: true,
      listModels: true,
    },
  ],
  [
    'kimi',
    {
      connector: 'openai',
      json: 'schema',
      thinking: effort('reasoning_effort', ['low', 'low', 'high', 'high', 'max']),
      maxTokens: 'max_completion_tokens',
      temperature: false,
      listModels: true,
    },
  ],
  [
    'zai',
    {
      connector: 'openai',
      json: 'object',
      thinking: onOrOff(['low', 'high', 'high', 'max']),
      maxTokens: 'max_tokens',
      temperature: true,
      listModels: false,
    },
  ],
  [
    'qwen',
    {
      connector: 'openai',
      json: 'object',
      thinking: {
        off: { enable_thinking: false },
        low: { enable_thinking: true, thinking_budget: 512 },
        medium: { enable_thinking: true, thinking_budget: 2048 },
        high: { enable_thinking: true, thinking_budget: 8192 },
        max: { enable_thinking: true },
      },
      maxTokens: 'max_tokens',
      temperature: true,
      listModels: false,
    },
  ],
  [
    'mistral',
    {
      connector: 'openai',
      json: 'schema',
      thinking: effort('reasoning_effort', [null, 'high', 'high', 'high', 'high']),
      maxTokens: 'max_tokens',
      temperature: true,
      listModels: true,
    },
  ],
  [
    'xai',
    {
      connector: 'openai',
      json: 'schema',
      thinking: effort('reasoning_effort', ['low', 'low', 'medium', 'high', 'xhigh']),
      maxTokens: 'max_completion_tokens',
      temperature: true,
      listModels: true,
    },
  ],
  [
    'groq',
    {
      connector: 'openai',
      json: 'schema',
      thinking: effort('reasoning_effort', ['low', 'low', 'medium', 'high', 'high']),
      maxTokens: 'max_completion_tokens',
      temperature: true,
      listModels: true,
    },
  ],
  [
    'openrouter',
    {
      connector: 'openai',
      json: 'schema',
      thinking: {
        off: null,
        low: openRouter('low'),
        medium: openRouter('medium'),
        high: openRouter('high'),
        max: openRouter('high'),
      },
      maxTokens: 'max_tokens',
      temperature: true,
      listModels: true,
    },
  ],
];

describe('the provider catalogue', () => {
  it('has 15 presets, cloud first, in the order the dropdown shows them', () => {
    expect(AiPresetId.options).toEqual([...CLOUD, ...LOCAL]);
    expect(Object.keys(AI_PRESETS)).toEqual([...CLOUD, ...LOCAL]);
    expect(PRESETS_CHECKED).toBe('31 Oct 2026');
  });

  it.each(CLOUD)('%s is a cloud AI that needs a key, with an https address, a key link and the cloud note', (id) => {
    const preset = AI_PRESETS[id];
    expect(preset.group).toBe('cloud');
    expect(preset.key).toBe('required');
    expect(preset.keyUrl).toMatch(/^https:\/\//);
    expect(preset.baseUrl).toMatch(/^https:\/\//);
    expect(preset.note?.startsWith(cloudNote(PROVIDER_NAMES[id]!))).toBe(true);
    expect(preset.managed).toBe(false);
    expect(preset.needsModel).toBe(true);
    expect(preset.models.length).toBeGreaterThan(0);
  });

  it.each(LOCAL)('%s runs on this computer, with no key needed', (id) => {
    const preset = AI_PRESETS[id];
    expect(preset.group).toBe('local');
    expect(preset.key).toBe(id === 'custom' ? 'optional' : 'none');
    expect(preset.keyUrl).toBeNull();
  });

  it('talks to the four local presets exactly as before, so Bonsai 2 requests do not change', () => {
    for (const id of LOCAL) {
      expect(AI_PRESETS[id].dialect).toEqual({
        connector: 'openai',
        json: 'schema',
        thinking: 'llama',
        maxTokens: 'max_tokens',
        temperature: true,
        listModels: true,
      });
    }
  });

  it.each(TABLE)('%s speaks the dialect in the table', (id, dialect) => {
    expect(AI_PRESETS[id].dialect).toEqual(dialect);
  });

  it('covers every cloud preset in the dialect table', () => {
    expect(TABLE.map(([id]) => id)).toEqual(CLOUD);
  });

  it("uses Claude's own connector, suggests Sonnet 5.5 first, and says a Pro or Max login can't be used", () => {
    const claude = AI_PRESETS.anthropic;
    expect(claude.dialect.connector).toBe('anthropic');
    expect(claude.models).toEqual([
      { id: 'claude-sonnet-5-5', tag: 'Best value' },
      { id: 'claude-opus-5-5', tag: 'Recommended' },
      { id: 'claude-fable-5-1', tag: 'Best' },
      { id: 'claude-haiku-5-5', tag: 'Cheapest' },
    ]);
    expect(claude.note).toBe(
      `${cloudNote('Claude')} Use an API key from the Claude Console. A Claude Pro or Max login can't be used here.`,
    );
  });

  it("uses Z.ai's pay-per-use address, never the Coding Plan's, and says so", () => {
    const zai = AI_PRESETS.zai;
    expect(zai.baseUrl).toBe('https://api.z.ai/api/paas/v4');
    expect(zai.baseUrl).not.toContain('/coding/');
    expect(zai.note).toBe(
      `${cloudNote('Z.ai')} Use a pay-per-use API key, not your GLM Coding Plan. The Coding Plan only covers coding tools.`,
    );
  });

  it("tells you to use Qwen's workspace address if Alibaba Cloud gave you one", () => {
    expect(AI_PRESETS.qwen.note).toBe(`${cloudNote('Qwen')} If Alibaba Cloud gave you a workspace address, use that instead.`);
  });

  it('puts the best-value model first for the other cloud presets, or else the best', () => {
    for (const id of CLOUD.filter((one) => one !== 'anthropic')) {
      const tags = AI_PRESETS[id].models.map((m) => m.tag);
      expect(tags[0]).toBe(tags.includes('Best value') ? 'Best value' : 'Best');
    }
  });

  it('keeps the old preset ids and labels', () => {
    expect(AI_PRESETS['llama-server'].label).toBe('Bonsai 2 (llama-server)');
    expect(AI_PRESETS['llama-server']).toMatchObject({ baseUrl: 'http://127.0.0.1:8080/v1', managed: true, needsModel: false });
    expect(AI_PRESETS.ollama).toMatchObject({ label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', managed: false, needsModel: true });
    expect(AI_PRESETS.lmstudio).toMatchObject({ label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', managed: false, needsModel: true });
    expect(AI_PRESETS.custom).toMatchObject({ label: 'Another OpenAI-style server', baseUrl: null, managed: false, needsModel: true });
  });

  it("suggests Bonsai 2's 27B file", () => {
    expect(AI_PRESETS['llama-server'].models).toEqual([{ id: 'Ternary-Bonsai-2-27B-PQ2_0.gguf', tag: 'Best' }]);
  });
});

describe('newSavedAi', () => {
  it("makes a new AI from a preset: an id from the name, the preset's address and its first model", () => {
    const ai = newSavedAi('anthropic', 'Claude – mine', []);
    expect(SavedAi.parse(ai)).toEqual(ai);
    expect(ai).toMatchObject({
      id: 'claude-mine',
      name: 'Claude – mine',
      preset: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-5-5',
    });
    // The app can't start a cloud AI.
    expect(ai.managed.enabled).toBe(false);
  });

  it("takes every other field from today's defaults", () => {
    const ai = newSavedAi('openai', 'OpenAI', []);
    const defaults = SavedAi.parse({ id: 'x', name: 'x' });
    expect(ai.tasks).toEqual(defaults.tasks);
    expect(ai.timeoutSec).toBe(defaults.timeoutSec);
    expect(ai.stopWhenIdle).toBe(defaults.stopWhenIdle);
    expect(ai.idleMinutes).toBe(defaults.idleMinutes);
    expect(ai.managed).toEqual({ ...defaults.managed, enabled: false });
  });

  it('makes the id unique among the ones taken', () => {
    expect(newSavedAi('anthropic', 'Claude', ['claude']).id).toBe('claude-2');
  });

  it('lets the app start Bonsai 2, and leaves its model empty, as the default Bonsai 2 has it', () => {
    // A llama-server AI's model is the file it expects, so a name you didn't
    // pick could refuse the file your .bat runs.
    const ai = newSavedAi('llama-server', 'Bonsai 2', []);
    expect(ai).toMatchObject({ id: 'bonsai-2', baseUrl: 'http://127.0.0.1:8080/v1', model: '' });
    expect(ai.model).toBe(SavedAi.parse({ id: 'bonsai-2', name: 'Bonsai 2' }).model);
    expect(ai.managed.enabled).toBe(true);
  });

  it('leaves the model empty when the preset suggests none', () => {
    expect(newSavedAi('ollama', 'Ollama', [])).toMatchObject({ baseUrl: 'http://127.0.0.1:11434/v1', model: '' });
  });

  it('leaves the address empty for another OpenAI-style server, for you to fill in', () => {
    const ai = newSavedAi('custom', 'My AI server', []);
    expect(ai).toMatchObject({ id: 'my-ai-server', preset: 'custom', baseUrl: '', model: '' });
    expect(ai.managed.enabled).toBe(false);
  });
});
