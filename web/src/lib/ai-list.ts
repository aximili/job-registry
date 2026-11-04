// Settings → AI's "My AIs" list and the header's AI switcher: copying and
// deleting a saved AI, the line that sums one up, the groups of the "Add an
// AI" list, and the AI that writes your documents. Pure functions: the
// components save what they return.

import {
  activeAi,
  AI_PRESETS,
  newAiId,
  opensWindow,
  sameAddressWarning,
  writingAi,
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

// A change to the AI section, as it's sent. With no writer, the server keeps
// the one saved, or drops it when it isn't among the AIs after the change.
export type AiChange = Omit<AiSettings, 'writer'> & { writer?: string | null };

// The writer to send with a change to the AI section: none (undefined), so a
// writer picked meanwhile (here or in another tab) stays; or null when a new
// AI or a copy gets the id of a writer that isn't saved any more (a hand
// edit), so it never writes by accident.
export function writerToSend(ai: AiChange, saved: readonly SavedAi[]): null | undefined {
  const writer = ai.writer ?? null;
  const has = (list: readonly SavedAi[]) => list.some((one) => one.id === writer);
  return writer !== null && !has(ai.saved) && has(saved) ? null : undefined;
}

// The change with its writer as writerToSend says.
function change(ai: AiChange, saved: SavedAi[]): AiChange {
  const { writer: _old, ...rest } = ai;
  const writer = writerToSend(ai, saved);
  return writer === undefined ? { ...rest, saved } : { ...rest, writer, saved };
}

// A copy of one AI, straight after it, with a name and an id of its own.
// Keys live in secrets.json, not here, so the copy has none.
export function duplicateAi(ai: AiChange, id: string): AiChange {
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
  return change(ai, [...ai.saved.slice(0, at + 1), copy, ...ai.saved.slice(at + 1)]);
}

// Why an AI can't be deleted, or null when it can.
export function deleteBlock(ai: Pick<AiSettings, 'active' | 'saved'>, id: string): string | null {
  if (ai.saved.length <= 1) return 'You need at least one AI.';
  if (ai.active === id) return 'Switch to another AI first.';
  return null;
}

// The AI section without one AI. Throws deleteBlock's sentence when it can't go.
export function removeAi(ai: AiChange, id: string): AiChange {
  const block = deleteBlock(ai, id);
  if (block) throw new Error(block);
  return change(ai, ai.saved.filter((one) => one.id !== id));
}

// A saved AI's name, or "this AI" when it isn't saved.
export function nameOf(ai: Pick<AiSettings, 'saved'>, id: string): string {
  return ai.saved.find((one) => one.id === id)?.name ?? 'this AI';
}

// What Delete asks: "Delete Claude – mine?", and what goes with it.
export function deleteQuestion(ai: AiSettings, id: string, hasKey: boolean): string {
  const name = nameOf(ai, id);
  const key = hasKey ? ' Its API key is deleted too.' : '';
  const writes = ai.writer === id ? ` ${name} also writes your documents. After this, the AI in use writes them.` : '';
  return `Delete ${name}?${key}${writes}`;
}

// The writing AI's list: "The AI in use ({name})" first (value ''), then
// every saved AI by name.
export function writerChoices(ai: AiSettings): { value: string; label: string }[] {
  return [{ value: '', label: `The AI in use (${activeAi(ai).name})` }, ...ai.saved.map((one) => ({ value: one.id, label: one.name }))];
}

// What the list shows: the AI you picked while it's saved, or else '' (the
// AI in use).
export function writerValue(ai: AiSettings): string {
  return writingAi(ai).missing || ai.writer === null ? '' : ai.writer;
}

// The toast after a pick. null is the AI in use.
export function writerMessage(ai: AiSettings, id: string | null): string {
  return id === null ? 'The AI in use writes your documents now.' : `${nameOf(ai, id)} writes your documents now.`;
}

// The sentence when the AI you picked to write isn't saved any more (a hand
// edit of settings.json), or null.
export function writerFallback(ai: AiSettings): string | null {
  const writing = writingAi(ai);
  return writing.missing ? `Your writing AI isn't saved any more, so ${writing.ai.name}, the AI in use, writes.` : null;
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
