// Settings → AI's "My AIs" list and the header's AI switcher: copying and
// deleting a saved AI, the line that sums one up, and the groups of the
// "Add an AI" list. Pure functions: the components save what they return.

import {
  AI_PRESETS,
  newAiId,
  opensWindow,
  sameAddressWarning,
  type AiPresetId,
  type AiSettings,
  type SavedAi,
} from '../../../shared/contracts/index.ts';

const NAME_MAX = 60;

// "{name} (copy)", or "(copy 2)", "(copy 3)" … when that name is taken, cut
// so it stays within 60 characters.
function copyName(name: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (copy)' : ` (copy ${n})`;
    const candidate = `${name.slice(0, NAME_MAX - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

// A copy of one AI, straight after it, with a name and an id of its own.
// Keys live in secrets.json, not here, so the copy has none.
export function duplicateAi(ai: AiSettings, id: string): AiSettings {
  const at = ai.saved.findIndex((one) => one.id === id);
  if (at === -1) return ai;
  const original = ai.saved[at]!;
  const name = copyName(original.name, new Set(ai.saved.map((one) => one.name.trim().toLowerCase())));
  const copy: SavedAi = {
    ...plainCopy(original),
    id: newAiId(
      name,
      ai.saved.map((one) => one.id),
    ),
    name,
  };
  return { ...ai, saved: [...ai.saved.slice(0, at + 1), copy, ...ai.saved.slice(at + 1)] };
}

// Why an AI can't be deleted, or null when it can.
export function deleteBlock(ai: AiSettings, id: string): string | null {
  if (ai.saved.length <= 1) return 'You need at least one AI.';
  if (ai.active === id) return 'Switch to another AI first.';
  return null;
}

// The AI section without one AI. Throws deleteBlock's sentence when it can't go.
export function removeAi(ai: AiSettings, id: string): AiSettings {
  const block = deleteBlock(ai, id);
  if (block) throw new Error(block);
  return { ...ai, saved: ai.saved.filter((one) => one.id !== id) };
}

const fileName = (path: string): string => path.trim().replaceAll('\\', '/').split('/').pop() ?? '';

// The model a saved AI runs, for its summary. Bonsai 2's llama-server
// ignores the model name, so there it's the model file: the one after -m
// when the app starts the program, or else the Model file you filled in.
// Your own .bat file with no Model file shows the .bat file's name.
function modelOf(ai: SavedAi): string {
  if (ai.preset !== 'llama-server') return ai.model.trim();
  const starts = ai.managed.enabled;
  if (starts && !opensWindow(ai.managed.exe)) {
    const at = ai.managed.args.findIndex((arg) => arg === '-m' || arg === '--model');
    const file = at === -1 ? '' : fileName(ai.managed.args[at + 1] ?? '');
    if (file) return file;
  }
  if (ai.model.trim()) return fileName(ai.model);
  return starts && opensWindow(ai.managed.exe) ? fileName(ai.managed.exe) : '';
}

// "Claude (Anthropic API) · claude-sonnet-5-5", or "· no model".
export function aiSummary(ai: SavedAi): string {
  return `${AI_PRESETS[ai.preset].label} · ${modelOf(ai) || 'no model'}`;
}

// The "Add an AI" list: cloud first, then this computer, in catalogue order.
export function presetGroups(): { label: 'Cloud' | 'On this computer'; ids: AiPresetId[] }[] {
  const all = Object.keys(AI_PRESETS) as AiPresetId[];
  return [
    { label: 'Cloud', ids: all.filter((id) => AI_PRESETS[id].group === 'cloud') },
    { label: 'On this computer', ids: all.filter((id) => AI_PRESETS[id].group === 'local') },
  ];
}

// The name a new AI starts with: the provider's short name ("Claude" for
// "Claude (Anthropic API)"), with "(2)", "(3)" … when you have one already.
export function defaultAiName(preset: AiPresetId, names: readonly string[]): string {
  const base = preset === 'custom' ? 'My AI server' : AI_PRESETS[preset].label.replace(/\s*\(.*\)\s*$/, '');
  const taken = new Set(names.map((n) => n.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const name = `${base} (${n})`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

// Whether an AI needs an API key and has none saved ("No API key yet").
// keys are the ids of the AIs with a key, or null while they aren't known:
// then nothing is flagged.
export function noKeyYet(ai: SavedAi, keys: readonly string[] | null): boolean {
  return keys !== null && AI_PRESETS[ai.preset].key === 'required' && !keys.includes(ai.id);
}

// What a switch says: "Now using Claude – mine.", plus a warning when the AI
// you left may still be answering on the new one's address, and a reminder
// when the new one has no API key yet. from is null when it isn't known.
export function switchMessage(from: SavedAi | null, to: SavedAi, o: { noKey?: boolean } = {}): string {
  const warning = from ? sameAddressWarning(from, to) : null;
  const noKey = o.noKey ? ' No API key yet: add one in Settings → AI.' : '';
  return `Now using ${to.name}.${warning ? ` ${warning}` : ''}${noKey}`;
}

// A deep copy. structuredClone can't copy a Svelte state proxy, and
// settings are plain JSON, so a JSON copy loses nothing.
function plainCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
