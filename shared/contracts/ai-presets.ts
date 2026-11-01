import { z } from 'zod';

// Every kind of AI you can add: its address, where to get a key, the models
// we suggest, and how the app talks to it (its dialect).
// To update: check each provider's own docs, change what moved, and set
// PRESETS_CHECKED to the day you checked.
export const PRESETS_CHECKED = '31 Oct 2026';

// Cloud first, then the ones on this computer. The "Add an AI" list uses
// this order. The four local ids are the ones older settings files use.
export const AiPresetId = z.enum([
  'anthropic',
  'openai',
  'gemini',
  'deepseek',
  'kimi',
  'zai',
  'qwen',
  'mistral',
  'xai',
  'groq',
  'openrouter',
  'llama-server',
  'ollama',
  'lmstudio',
  'custom',
]);
export type AiPresetId = z.infer<typeof AiPresetId>;

// A task's thinking: off, or on at one of the four levels.
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

// The request fields each thinking level adds. null adds nothing.
export type ThinkingMap = Record<ThinkingLevel, Record<string, unknown> | null>;

// How one provider wants to be asked.
export type AiDialect = {
  // OpenAI-style chat, or Claude's own Messages API.
  connector: 'openai' | 'anthropic';
  // 'schema': response_format json_schema. 'object': json_object, with the
  // schema written into the system message.
  json: 'schema' | 'object';
  // 'llama': the llama-server fields, as before Phase 8.
  thinking: 'llama' | ThinkingMap;
  // The name of the field that holds the longest answer.
  maxTokens: 'max_tokens' | 'max_completion_tokens';
  // false: never send temperature (the provider refuses it).
  temperature: boolean;
  // false: the provider has no model list, so only the suggestions show.
  listModels: boolean;
};

export type ModelTag = 'Best' | 'Recommended' | 'Best value' | 'Fast' | 'Cheapest' | 'Free tier' | 'Small, for a busy PC';

export type AiPreset = {
  label: string;
  group: 'cloud' | 'local';
  // null: you type the address.
  baseUrl: string | null;
  key: 'required' | 'optional' | 'none';
  // Where you get a key.
  keyUrl: string | null;
  needsModel: boolean;
  // Whether the app can start it (only Bonsai 2's llama-server).
  managed: boolean;
  dialect: AiDialect;
  // Shown when you add or edit an AI of this kind.
  note: string | null;
  // The first is the model a new AI starts with, if the preset needs one.
  models: { id: string; tag: ModelTag }[];
};

// Shown for every cloud AI, with the provider's name, then the provider's
// own note if it has one.
const cloudNote = (provider: string, extra?: string): string =>
  `${provider} sees your profile, the ads you save and rate, and (if email is on) your emails. Each request is billed to this key. Quick marks rate every card on a search page, so they use the most.` +
  (extra ? ` ${extra}` : '');

// Thinking as one field, with a value for each level.
function effort(field: string, levels: Record<ThinkingLevel, string | null>): ThinkingMap {
  const one = (v: string | null) => (v === null ? null : { [field]: v });
  return { off: one(levels.off), low: one(levels.low), medium: one(levels.medium), high: one(levels.high), max: one(levels.max) };
}

// Thinking turned off, or turned on with an effort (DeepSeek and Z.ai).
function onOrOff(levels: Record<Exclude<ThinkingLevel, 'off'>, string>): ThinkingMap {
  const on = (v: string) => ({ thinking: { type: 'enabled' }, reasoning_effort: v });
  return {
    off: { thinking: { type: 'disabled' } },
    low: on(levels.low),
    medium: on(levels.medium),
    high: on(levels.high),
    max: on(levels.max),
  };
}

// Claude's thinking is always adaptive (it decides how much), with an
// effort. Most current models refuse "disabled". These are the fields
// Claude's Messages API takes.
const adaptive = (v: string) => ({ thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: v } });

const openRouter = (v: string) => ({ reasoning: { effort: v } });

// Bonsai 2 and the other servers on this computer: as before Phase 8.
const LOCAL_DIALECT: AiDialect = {
  connector: 'openai',
  json: 'schema',
  thinking: 'llama',
  maxTokens: 'max_tokens',
  temperature: true,
  listModels: true,
};

// Many cloud models can't stop thinking, so "off" asks for the least
// thinking the provider takes. A task's extra fields can change any of this.
export const AI_PRESETS: Record<AiPresetId, AiPreset> = {
  anthropic: {
    label: 'Claude (Anthropic API)',
    group: 'cloud',
    baseUrl: 'https://api.anthropic.com/v1',
    key: 'required',
    // The /settings/keys path is unverified.
    keyUrl: 'https://platform.claude.com/settings/keys',
    needsModel: true,
    managed: false,
    // Claude's connector asks for JSON by schema and always sends max_tokens.
    dialect: {
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
    note: cloudNote('Claude', "Use an API key from the Claude Console. A Claude Pro or Max login can't be used here."),
    // Sonnet first, not Opus as Anthropic suggests: quick marks rate every
    // card on a page, so cost matters most.
    models: [
      { id: 'claude-sonnet-5-5', tag: 'Best value' },
      { id: 'claude-opus-5-5', tag: 'Recommended' },
      { id: 'claude-fable-5-1', tag: 'Best' },
      { id: 'claude-haiku-5-5', tag: 'Cheapest' },
    ],
  },
  openai: {
    label: 'OpenAI',
    group: 'cloud',
    baseUrl: 'https://api.openai.com/v1',
    key: 'required',
    // This keys page address is unverified.
    keyUrl: 'https://platform.openai.com/api-keys',
    needsModel: true,
    managed: false,
    dialect: {
      connector: 'openai',
      json: 'schema',
      thinking: effort('reasoning_effort', { off: 'low', low: 'low', medium: 'medium', high: 'high', max: 'max' }),
      maxTokens: 'max_completion_tokens',
      temperature: false,
      listModels: true,
    },
    note: cloudNote('OpenAI'),
    models: [
      { id: 'gpt-6.1-sol', tag: 'Best value' },
      { id: 'gpt-6-astra', tag: 'Best' },
      { id: 'gpt-6.1-terra', tag: 'Fast' },
      { id: 'gpt-6-luna', tag: 'Cheapest' },
    ],
  },
  gemini: {
    label: 'Google Gemini',
    group: 'cloud',
    // Google's OpenAI-style address, which Google still calls beta.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    key: 'required',
    // This keys page address is unverified.
    keyUrl: 'https://aistudio.google.com/apikey',
    needsModel: true,
    managed: false,
    // A JSON schema works. How Google treats "strict" is unverified.
    dialect: {
      connector: 'openai',
      json: 'schema',
      thinking: effort('reasoning_effort', { off: 'minimal', low: 'low', medium: 'medium', high: 'high', max: 'high' }),
      maxTokens: 'max_tokens',
      temperature: true,
      listModels: true,
    },
    note: cloudNote('Google Gemini'),
    models: [
      { id: 'gemini-3.8-flash', tag: 'Best value' },
      { id: 'gemini-4-argon', tag: 'Best' },
      { id: 'gemini-3.5-flash-lite', tag: 'Fast' },
    ],
  },
  deepseek: {
    label: 'DeepSeek',
    group: 'cloud',
    baseUrl: 'https://api.deepseek.com',
    key: 'required',
    // The keys page itself is unverified, so this is the console's front page.
    keyUrl: 'https://platform.deepseek.com',
    needsModel: true,
    managed: false,
    dialect: {
      connector: 'openai',
      json: 'object',
      thinking: onOrOff({ low: 'low', medium: 'high', high: 'high', max: 'max' }),
      maxTokens: 'max_tokens',
      temperature: true,
      listModels: true,
    },
    note: cloudNote('DeepSeek'),
    models: [
      { id: 'deepseek-flash', tag: 'Best value' },
      { id: 'deepseek-v4-pro', tag: 'Best' },
    ],
  },
  kimi: {
    label: 'Kimi (Moonshot)',
    group: 'cloud',
    // The international address. Keys from platform.kimi.com (China) don't work here.
    baseUrl: 'https://api.moonshot.ai/v1',
    key: 'required',
    keyUrl: 'https://platform.kimi.ai/console/api-keys',
    needsModel: true,
    managed: false,
    dialect: {
      connector: 'openai',
      json: 'schema',
      thinking: effort('reasoning_effort', { off: 'low', low: 'low', medium: 'high', high: 'high', max: 'max' }),
      maxTokens: 'max_completion_tokens',
      temperature: false,
      listModels: true,
    },
    note: cloudNote('Kimi'),
    models: [
      { id: 'kimi-k3', tag: 'Best value' },
      { id: 'kimi-k3.1-pro', tag: 'Best' },
      { id: 'kimi-k3.1-pro-highspeed', tag: 'Fast' },
    ],
  },
  zai: {
    label: 'Z.ai (GLM)',
    group: 'cloud',
    // The pay-per-use address. Never the Coding Plan's (/api/coding/paas/v4).
    baseUrl: 'https://api.z.ai/api/paas/v4',
    key: 'required',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    needsModel: true,
    managed: false,
    // No model list is documented (unverified).
    dialect: {
      connector: 'openai',
      json: 'object',
      thinking: onOrOff({ low: 'low', medium: 'high', high: 'high', max: 'max' }),
      maxTokens: 'max_tokens',
      temperature: true,
      listModels: false,
    },
    note: cloudNote('Z.ai', 'Use a pay-per-use API key, not your GLM Coding Plan. The Coding Plan only covers coding tools.'),
    models: [
      { id: 'glm-4.7', tag: 'Best value' },
      { id: 'glm-5.3', tag: 'Best' },
      { id: 'glm-4.7-flashx', tag: 'Fast' },
      // Z.ai names it GLM-4.7-Flash. The lower-case id is unverified.
      { id: 'glm-4.7-flash', tag: 'Free tier' },
    ],
  },
  qwen: {
    label: 'Qwen (Alibaba Cloud)',
    group: 'cloud',
    // The older international address. Unverified that it still works: the
    // docs now give each workspace its own address.
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    key: 'required',
    keyUrl: 'https://modelstudio.console.alibabacloud.com/model/settings/api-key',
    needsModel: true,
    managed: false,
    // No model list is documented (unverified).
    dialect: {
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
    note: cloudNote('Qwen', 'If Alibaba Cloud gave you a workspace address, use that instead.'),
    models: [
      { id: 'qwen3.7-plus', tag: 'Best value' },
      { id: 'qwen3.8-max', tag: 'Best' },
      { id: 'qwen3.8-flash', tag: 'Fast' },
    ],
  },
  mistral: {
    label: 'Mistral',
    group: 'cloud',
    baseUrl: 'https://api.mistral.ai/v1',
    key: 'required',
    // The keys page itself is unverified, so this is the console's front page.
    keyUrl: 'https://console.mistral.ai',
    needsModel: true,
    managed: false,
    // Medium 3.5 and Small 4 take only "none" or "high", and Large 4 refuses
    // "none". So every level asks for "high", the one value all three take,
    // and off sends nothing.
    dialect: {
      connector: 'openai',
      json: 'schema',
      thinking: effort('reasoning_effort', { off: null, low: 'high', medium: 'high', high: 'high', max: 'high' }),
      maxTokens: 'max_tokens',
      temperature: true,
      listModels: true,
    },
    note: cloudNote('Mistral'),
    models: [
      { id: 'mistral-medium-3-5', tag: 'Best value' },
      { id: 'mistral-large-4', tag: 'Best' },
      { id: 'mistral-small-latest', tag: 'Fast' },
    ],
  },
  xai: {
    label: 'xAI (Grok)',
    group: 'cloud',
    baseUrl: 'https://api.x.ai/v1',
    key: 'required',
    keyUrl: 'https://console.x.ai',
    needsModel: true,
    managed: false,
    // Its model list (/v1/models) is unverified.
    dialect: {
      connector: 'openai',
      json: 'schema',
      thinking: effort('reasoning_effort', { off: 'low', low: 'low', medium: 'medium', high: 'high', max: 'xhigh' }),
      maxTokens: 'max_completion_tokens',
      temperature: true,
      listModels: true,
    },
    note: cloudNote('xAI'),
    models: [
      { id: 'grok-4.3', tag: 'Best value' },
      { id: 'grok-4.7', tag: 'Best' },
      { id: 'grok-4.20-0309-non-reasoning', tag: 'Fast' },
    ],
  },
  groq: {
    label: 'Groq',
    group: 'cloud',
    baseUrl: 'https://api.groq.com/openai/v1',
    key: 'required',
    // This keys page address is unverified.
    keyUrl: 'https://console.groq.com/keys',
    needsModel: true,
    managed: false,
    dialect: {
      connector: 'openai',
      json: 'schema',
      thinking: effort('reasoning_effort', { off: 'low', low: 'low', medium: 'medium', high: 'high', max: 'high' }),
      maxTokens: 'max_completion_tokens',
      temperature: true,
      listModels: true,
    },
    note: cloudNote('Groq'),
    models: [
      { id: 'openai/gpt-oss-20b', tag: 'Best value' },
      { id: 'openai/gpt-oss-120b', tag: 'Best' },
    ],
  },
  openrouter: {
    label: 'OpenRouter',
    group: 'cloud',
    baseUrl: 'https://openrouter.ai/api/v1',
    key: 'required',
    // This keys page address is unverified.
    keyUrl: 'https://openrouter.ai/settings/keys',
    needsModel: true,
    managed: false,
    dialect: {
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
    note: cloudNote('OpenRouter'),
    models: [
      { id: 'deepseek/deepseek-v4.1-flash', tag: 'Best value' },
      { id: 'anthropic/claude-fable-5.1', tag: 'Best' },
      { id: 'openai/gpt-6-luna', tag: 'Fast' },
      { id: 'google/gemma-4-31b-it:free', tag: 'Free tier' },
    ],
  },
  'llama-server': {
    label: 'Bonsai 2 (llama-server)',
    group: 'local',
    baseUrl: 'http://127.0.0.1:8080/v1',
    key: 'none',
    keyUrl: null,
    needsModel: false,
    managed: true,
    dialect: LOCAL_DIALECT,
    note: null,
    // The file download-ai.bat fetches. llama-server ignores the name.
    models: [{ id: 'Ternary-Bonsai-2-27B-PQ2_0.gguf', tag: 'Best' }],
  },
  ollama: {
    label: 'Ollama',
    group: 'local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    key: 'none',
    keyUrl: null,
    needsModel: true,
    managed: false,
    dialect: LOCAL_DIALECT,
    note: null,
    models: [],
  },
  lmstudio: {
    label: 'LM Studio',
    group: 'local',
    baseUrl: 'http://127.0.0.1:1234/v1',
    key: 'none',
    keyUrl: null,
    needsModel: true,
    managed: false,
    dialect: LOCAL_DIALECT,
    note: null,
    models: [],
  },
  custom: {
    label: 'Another OpenAI-style server',
    group: 'local',
    baseUrl: null,
    key: 'optional',
    keyUrl: null,
    needsModel: true,
    managed: false,
    dialect: LOCAL_DIALECT,
    note: null,
    models: [],
  },
};
