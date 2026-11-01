// Which saved AI npm run eval:parse runs, and the run's own copy of your
// settings and that AI's key. Your own settings and secrets are only read.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pino } from 'pino';
import { activeAi, AI_PRESETS, type AiSettings, type SavedAi } from '../shared/contracts/index.ts';
import { createEventBus } from '../server/core/events.ts';
import { createSettingsModule } from '../server/modules/settings/index.ts';

// A saved AI by its name, or else by its id, in any case.
export function findAi(ai: AiSettings, wanted: string): SavedAi | null {
  const text = wanted.trim().toLowerCase();
  return ai.saved.find((one) => one.name.toLowerCase() === text) ?? ai.saved.find((one) => one.id === text) ?? null;
}

// Gets the run's config folder ready. It already holds the run's copy of
// your settings (or nothing, for the defaults). This puts the AI to run in
// use there: the one --ai names, or else the AI in use. Then it copies that
// AI's key, and no other, into the folder's own secrets.json.
export function prepareEvalConfig(o: { configDir: string; yourSecrets: string; wanted?: string }): { ai: SavedAi } | { problem: string } {
  // The settings are the run's copy. Your secrets file is only read, with
  // the app's own rules (spaces and newlines in a pasted key are dropped).
  // Nothing here may change it, so this never calls update or updateSecrets.
  const settings = createSettingsModule({
    file: join(o.configDir, 'settings.json'),
    secretsFile: o.yourSecrets,
    bus: createEventBus(pino({ level: 'silent' })),
  }).service;
  const all = settings.get().ai;
  const ai = o.wanted === undefined ? activeAi(all) : findAi(all, o.wanted);
  if (!ai) {
    // With each id, which is easier to type than a name with a dash or an accent.
    const names = all.saved.map((one) => `"${one.name}" (${one.id})`).join(', ');
    return { problem: `There's no saved AI called "${o.wanted?.trim()}". Your saved AIs: ${names}.` };
  }
  if (ai.id !== all.active) settings.useAi(ai.id);
  // As the app does: an AI that takes no key never reads one.
  const key = AI_PRESETS[ai.preset].key === 'none' ? null : settings.aiKey(ai.id);
  if (key) writeFileSync(join(o.configDir, 'secrets.json'), `${JSON.stringify({ emailPassword: null, aiKeys: { [ai.id]: key } }, null, 2)}\n`);
  return { ai };
}
