import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  activeAi,
  AiCheckRequest,
  AiModelsResult,
  AiSettings,
  Brief,
  BriefEdits,
  Capture,
  DEFAULT_AI_ID,
  DEFAULT_SETTINGS,
  expectedModelFile,
  IsoDateTime,
  JobCard,
  newAiId,
  PrepAnswer,
  PrepPlan,
  Rating,
  sameAddressWarning,
  SaveJobRequest,
  SetFollowUpRequest,
  Settings,
  Status,
  UseWriterRequest,
  writingAi,
  type SavedAi,
} from './index.ts';

const capturedAt = '2026-10-28T03:15:00.000Z';

describe('contracts', () => {
  it('parses a minimal pasted capture', () => {
    const capture = Capture.parse({
      sourceUrl: null,
      canonicalUrl: null,
      sourceSite: 'pasted',
      externalId: null,
      jdText: 'x',
      capturedAt,
    });
    expect(capture.sourceSite).toBe('pasted');
  });

  it('accepts both save decisions', () => {
    const capture = { sourceUrl: null, canonicalUrl: null, sourceSite: 'pasted', externalId: null, jdText: 'x', capturedAt };
    expect(SaveJobRequest.safeParse({ capture, decision: 'new' }).success).toBe(true);
    expect(SaveJobRequest.safeParse({ capture, decision: { linkTo: 3 } }).success).toBe(true);
    expect(SaveJobRequest.safeParse({ capture, decision: { linkTo: 'x' } }).success).toBe(false);
  });

  it('rejects a status id with spaces', () => {
    const result = Status.safeParse({ id: 'Interview 1', label: 'Interview 1', closed: false, order: 10, setsAppliedDate: false });
    expect(result.success).toBe(false);
  });

  it('fills every settings default from {}', () => {
    const settings = Settings.parse({});
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.server.port).toBe(4777);
    expect(settings.backups).toEqual({ dir: 'data/backups', keep: 14 });
    expect(settings.statuses).toHaveLength(11);
    expect(settings.statuses.find((s) => s.id === 'applied')?.setsAppliedDate).toBe(true);
    expect(settings.statuses.filter((s) => s.closed).map((s) => s.id)).toEqual(['rejected', 'withdrawn', 'no_response']);
  });

  it('refuses duplicate status ids', () => {
    const [first] = DEFAULT_SETTINGS.statuses;
    const result = Settings.safeParse({ statuses: [first, first] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("Status id 'saved' is used twice.");
  });
});

describe('settings: reserved status ids', () => {
  it('refuses open, closed and all as status ids, because they are list filters', () => {
    const [first] = DEFAULT_SETTINGS.statuses;
    const result = Settings.safeParse({ statuses: [{ ...first, id: 'all' }] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("Status id 'all' is reserved.");
  });
});

describe('contracts: AI', () => {
  const ai = (raw: unknown) => activeAi(Settings.parse({ ai: raw }).ai);

  it('an empty settings file gets the AI defaults', () => {
    const bonsai = activeAi(DEFAULT_SETTINGS.ai);
    expect(bonsai.preset).toBe('llama-server');
    expect(bonsai.tasks.parse.thinking).toBe(false);
    expect(bonsai.managed.args).toContain('-ngl');
  });

  it('the app never stops the AI when idle unless you turn it on', () => {
    expect(activeAi(DEFAULT_SETTINGS.ai).stopWhenIdle).toBe(false);
    expect(activeAi(DEFAULT_SETTINGS.ai).idleMinutes).toBe(15);
    expect(ai({ stopWhenIdle: true, idleMinutes: 30 })).toMatchObject({ stopWhenIdle: true, idleMinutes: 30 });
  });

  it('a partial ai section keeps the other defaults', () => {
    const s = ai({ preset: 'ollama', model: 'qwen3:8b', tasks: { parse: { model: 'small' } } });
    expect(s.tasks.rate.maxTokens).toBe(2048);
    expect(s.tasks.parse).toMatchObject({ model: 'small', temperature: 0.2, maxTokens: 4096 });
    expect(s.managed.enabled).toBe(true);
  });

  it('a misspelt ai key is refused', () => {
    expect(Settings.safeParse({ ai: { modle: 'x' } }).success).toBe(false);
  });

  it('a rating has at most four reasons each way', () => {
    const rating = { verdict: 'good', score: 70, why: ['a', 'b', 'c', 'd'], whyNot: [], dealBreakers: [], salaryNote: null };
    expect(Rating.safeParse(rating).success).toBe(true);
    expect(Rating.safeParse({ ...rating, why: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false);
  });
});

describe('contracts: saved AIs', () => {
  const oldFile = JSON.parse(readFileSync(new URL('../../tests/fixtures/settings/old-flat-settings.json', import.meta.url), 'utf8'));
  const bonsai = activeAi(DEFAULT_SETTINGS.ai);
  const claude = { ...bonsai, id: 'claude-mine', name: 'Claude – mine', preset: 'custom', baseUrl: 'https://api.example.com/v1' };

  it('an empty settings file has one AI, Bonsai 2, with the defaults', () => {
    const s = Settings.parse({});
    expect(DEFAULT_AI_ID).toBe('bonsai-2');
    expect(s.ai.active).toBe('bonsai-2');
    expect(s.ai.saved).toHaveLength(1);
    expect(s.ai.saved[0]).toMatchObject({ id: 'bonsai-2', name: 'Bonsai 2', preset: 'llama-server', baseUrl: 'http://127.0.0.1:8080/v1' });
    expect(s.ai.saved[0]?.tasks.write.thinkingEffort).toBe('max');
  });

  it("your old settings file loads as one saved AI, with nothing lost", () => {
    const s = Settings.parse(oldFile);
    expect(s.ai.active).toBe('bonsai-2');
    // No writing AI of its own: the AI in use writes, as before.
    expect(s.ai.writer).toBeNull();
    expect(s.ai.saved).toHaveLength(1);
    const { id, name, ...rest } = s.ai.saved[0]!;
    expect({ id, name }).toEqual({ id: 'bonsai-2', name: 'Bonsai 2' });
    // Every old field, exactly as it was: the .bat program, the edited tasks and their extra fields.
    // The brief and the prep plan are newer, so they get their defaults.
    const { brief, prep, ...oldTasks } = rest.tasks;
    expect({ ...rest, tasks: oldTasks }).toEqual(oldFile.ai);
    expect(brief).toEqual(bonsai.tasks.brief);
    expect(prep).toEqual(bonsai.tasks.prep);
    expect(rest.managed.exe).toBe('D:\\aitest\\Bonsai-demo\\start_bonsai.bat');
    expect(rest.tasks.write).toEqual(oldFile.ai.tasks.write);
    expect(rest.tasks.card).toEqual(oldFile.ai.tasks.card);
    expect(rest.tasks.write.extra).toEqual({ min_p: 0.05, reasoning_effort: null });
    // The rest of the file is untouched.
    expect(s.email).toEqual(oldFile.email);
    expect(s.statuses).toEqual(oldFile.statuses);
  });

  it('each old preset gets a plain name', () => {
    expect(Settings.parse({ ai: { preset: 'ollama' } }).ai.saved[0]).toMatchObject({ id: 'ollama', name: 'Ollama' });
    expect(Settings.parse({ ai: { preset: 'lmstudio' } }).ai.saved[0]).toMatchObject({ id: 'lm-studio', name: 'LM Studio' });
    expect(Settings.parse({ ai: { preset: 'custom' } }).ai.saved[0]).toMatchObject({ id: 'my-ai-server', name: 'My AI server' });
    expect(Settings.parse({ ai: { preset: 'custom' } }).ai.active).toBe('my-ai-server');
  });

  it('a file in the new shape loads as it is', () => {
    const ai = { active: 'claude-mine', writer: 'bonsai-2', saved: [bonsai, claude] };
    expect(AiSettings.parse(ai)).toEqual(ai);
    expect(activeAi(AiSettings.parse(ai))).toEqual(claude);
    // A Phase 8 file has no writer: the AI in use writes.
    expect(AiSettings.parse({ active: 'claude-mine', saved: [bonsai, claude] })).toEqual({ ...ai, writer: null });
  });

  it('refuses an AI in use that is not saved, no saved AI, and one id used twice', () => {
    expect(AiSettings.safeParse({ active: 'nope', saved: [bonsai] }).success).toBe(false);
    expect(AiSettings.safeParse({ active: 'bonsai-2', saved: [] }).success).toBe(false);
    const twice = AiSettings.safeParse({ active: 'bonsai-2', saved: [bonsai, { ...claude, id: 'bonsai-2' }] });
    expect(twice.success).toBe(false);
    expect(JSON.stringify(twice.error?.issues)).toContain("AI id 'bonsai-2' is used twice.");
  });

  it('refuses a typo inside a saved AI, or beside the list', () => {
    expect(AiSettings.safeParse({ active: 'bonsai-2', saved: [{ ...bonsai, modle: 'x' }] }).success).toBe(false);
    expect(Settings.safeParse({ ai: { active: 'bonsai-2', saves: [bonsai] } }).success).toBe(false);
  });

  it('refuses an id with upper case, spaces, or more than 40 characters', () => {
    for (const id of ['Claude', 'claude mine', 'claude--mine', '-claude', 'x'.repeat(41)]) {
      expect(AiSettings.safeParse({ active: id, saved: [{ ...bonsai, id }] }).success, id).toBe(false);
    }
    expect(AiSettings.safeParse({ active: 'x'.repeat(40), saved: [{ ...bonsai, id: 'x'.repeat(40) }] }).success).toBe(true);
  });

  it('refuses a saved AI without a name', () => {
    expect(AiSettings.safeParse({ active: 'bonsai-2', saved: [{ ...bonsai, name: '  ' }] }).success).toBe(false);
  });

  it('newAiId makes an id from the name, unique among the ones taken', () => {
    expect(newAiId('Claude – wife’s', [])).toBe('claude-wife-s');
    expect(newAiId("Claude – wife's", [])).toBe('claude-wife-s');
    expect(newAiId('Claude', ['claude'])).toBe('claude-2');
    expect(newAiId('Claude', ['claude', 'claude-2'])).toBe('claude-3');
    expect(newAiId('!!!', [])).toBe('ai');
    expect(newAiId('', [])).toBe('ai');
    expect(newAiId('Café Qwen', [])).toBe('cafe-qwen');
    const long = newAiId('A very long name '.repeat(6), []);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const longAgain = newAiId('A very long name '.repeat(6), [long]);
    expect(longAgain.length).toBeLessThanOrEqual(40);
    expect(longAgain).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*-2$/);
  });

  it('activeAi gives the saved AI that is in use', () => {
    expect(activeAi({ active: 'claude-mine', writer: null, saved: [bonsai, claude] as never })).toBe(claude);
    expect(activeAi({ active: 'bonsai-2', writer: null, saved: [bonsai, claude] as never })).toBe(bonsai);
  });
});

describe('contracts: the AI that writes your documents', () => {
  const bonsai = activeAi(DEFAULT_SETTINGS.ai);
  const claude = { ...bonsai, id: 'claude-mine', name: 'Claude – mine', preset: 'custom', baseUrl: 'https://api.example.com/v1' };
  const two = (writer: string | null) => AiSettings.parse({ active: 'bonsai-2', writer, saved: [bonsai, claude] });

  it('an empty settings file has no writing AI of its own, so the AI in use writes', () => {
    expect(Settings.parse({}).ai.writer).toBeNull();
    expect(DEFAULT_SETTINGS.ai.writer).toBeNull();
  });

  it('your old one-AI settings file has no writing AI either', () => {
    expect(Settings.parse({ ai: { preset: 'ollama', model: 'qwen3:8b' } }).ai.writer).toBeNull();
  });

  it('writingAi: none picked means the AI in use', () => {
    const ai = two(null);
    expect(writingAi(ai)).toEqual({ ai: bonsai, inUse: true, missing: false });
    // The saved AI itself, as activeAi gives it.
    expect(writingAi(ai).ai).toBe(ai.saved[0]);
  });

  it('writingAi: another saved AI writes, and it is not the AI in use', () => {
    expect(writingAi(two('claude-mine'))).toEqual({ ai: claude, inUse: false, missing: false });
  });

  it('writingAi: picking the AI in use itself is the same as none', () => {
    expect(writingAi(two('bonsai-2'))).toEqual({ ai: bonsai, inUse: true, missing: false });
  });

  it("writingAi: a writer that isn't saved any more falls back to the AI in use, and says so", () => {
    // A hand edit that removes the AI still loads.
    const gone = two('claude-gone');
    expect(gone.writer).toBe('claude-gone');
    expect(writingAi(gone)).toEqual({ ai: bonsai, inUse: true, missing: true });
  });

  it('refuses a writer that is not an AI id', () => {
    for (const writer of ['Claude', 'claude mine', '', 'x'.repeat(41), 7]) {
      expect(AiSettings.safeParse({ active: 'bonsai-2', writer, saved: [bonsai] }).success, String(writer)).toBe(false);
    }
  });

  it('every saved AI has settings for making the brief and the prep plan', () => {
    const fresh = activeAi(Settings.parse({}).ai);
    expect(fresh.tasks.brief).toEqual({ model: null, temperature: 0.3, maxTokens: 3072, thinking: true, thinkingEffort: 'medium', extra: {} });
    expect(fresh.tasks.prep).toEqual({ model: null, temperature: 0.4, maxTokens: 4096, thinking: true, thinkingEffort: 'low', extra: {} });
  });

  it('a request to pick the writing AI: an id, or null for the AI in use', () => {
    expect(UseWriterRequest.parse({ id: 'claude-mine' })).toEqual({ id: 'claude-mine' });
    expect(UseWriterRequest.parse({ id: null })).toEqual({ id: null });
    expect(UseWriterRequest.safeParse({}).success).toBe(false);
    expect(UseWriterRequest.safeParse({ id: 'Claude' }).success).toBe(false);
    expect(UseWriterRequest.safeParse({ id: 'claude-mine', active: 'bonsai-2' }).success).toBe(false);
  });
});

describe('contracts: which model file a local AI runs', () => {
  const bonsai = activeAi(DEFAULT_SETTINGS.ai);
  // Your own start_bonsai.bat, with or without its "Model file".
  const bat = (id: string, name: string, model = ''): SavedAi => ({
    ...bonsai,
    id,
    name,
    model,
    managed: { ...bonsai.managed, exe: 'D:\\aitest\\Bonsai-demo\\start_bonsai.bat' },
  });

  it('expectedModelFile: the -m file of a program the app starts, in lower case and without its folder', () => {
    expect(bonsai.managed.args).toContain('ai/models/Ternary-Bonsai-2-27B-PQ2_0.gguf');
    expect(expectedModelFile(bonsai)).toBe('ternary-bonsai-2-27b-pq2_0.gguf');
    expect(expectedModelFile({ ...bonsai, managed: { ...bonsai.managed, args: ['--model', 'C:\\models\\Big.GGUF', '--port', '8080'] } })).toBe('big.gguf');
  });

  it("expectedModelFile: a .bat file's Model file, if you filled it in", () => {
    expect(expectedModelFile(bat('bonsai-2b', 'Bonsai 2B', 'D:\\m\\Bonsai-2B.gguf'))).toBe('bonsai-2b.gguf');
    expect(expectedModelFile(bat('bonsai-2b', 'Bonsai 2B'))).toBeNull();
    expect(expectedModelFile(bat('bonsai-2b', 'Bonsai 2B', '   '))).toBeNull();
  });

  it("expectedModelFile: a llama-server you start yourself, or a program with no -m, goes by the Model file too", () => {
    const yours = { ...bonsai, managed: { ...bonsai.managed, enabled: false } };
    expect(expectedModelFile(yours)).toBeNull();
    expect(expectedModelFile({ ...yours, model: '/models/Bonsai-2B.gguf' })).toBe('bonsai-2b.gguf');
    expect(expectedModelFile({ ...bonsai, model: 'Bonsai-2B.gguf', managed: { ...bonsai.managed, args: ['--port', '8080'] } })).toBe('bonsai-2b.gguf');
  });

  it('expectedModelFile: only a .gguf file counts, so a model name left over from another kind of AI is ignored', () => {
    // Switched from "Another OpenAI-style server" in the form: its model name stays.
    expect(expectedModelFile(bat('bonsai-2', 'Bonsai 2', 'bonsai'))).toBeNull();
    expect(expectedModelFile(bat('bonsai-2', 'Bonsai 2', 'qwen3:8b'))).toBeNull();
    expect(expectedModelFile({ ...bonsai, managed: { ...bonsai.managed, args: ['-m', 'ai/models/model.bin', '--port', '8080'] } })).toBeNull();
    expect(expectedModelFile({ ...bonsai, managed: { ...bonsai.managed, args: ['-m', 'model.bin'] }, model: 'D:\\m\\Bonsai-2B.GGUF' })).toBe('bonsai-2b.gguf');
  });

  it('expectedModelFile: every other kind of AI names its own models, so null', () => {
    expect(expectedModelFile({ ...bonsai, preset: 'ollama', model: 'qwen3:8b' })).toBeNull();
    expect(expectedModelFile({ ...bonsai, preset: 'custom', model: 'Bonsai-2B.gguf' })).toBeNull();
  });

  it('sameAddressWarning: a .bat AI on the same address, when the new one has no Model file', () => {
    const big = bat('bonsai-27b', 'Bonsai 27B');
    const small = bat('bonsai-2b', 'Bonsai 2B');
    expect(sameAddressWarning(big, small)).toBe('Bonsai 27B may still be running on 127.0.0.1:8080. Close its window if it is.');
    // One you start yourself is just as likely to still be running.
    expect(sameAddressWarning({ ...bonsai, id: 'mine', name: 'Mine', managed: { ...bonsai.managed, enabled: false } }, small)).toBe(
      'Mine may still be running on 127.0.0.1:8080. Close its window if it is.',
    );
  });

  it('sameAddressWarning: nothing when the app can check the model, stops the old one itself, or the addresses differ', () => {
    const big = bat('bonsai-27b', 'Bonsai 27B');
    const small = bat('bonsai-2b', 'Bonsai 2B');
    // The new one has a Model file: the app checks it before each task.
    expect(sameAddressWarning(big, { ...small, model: 'Bonsai-2B.gguf' })).toBeNull();
    // A program the app starts: the app stops it itself.
    expect(sameAddressWarning({ ...bonsai, id: 'bonsai-27b', name: 'Bonsai 27B' }, small)).toBeNull();
    expect(sameAddressWarning(big, { ...small, baseUrl: 'http://127.0.0.1:8081/v1' })).toBeNull();
    expect(sameAddressWarning(big, big)).toBeNull();
    expect(sameAddressWarning(big, { ...small, preset: 'ollama', baseUrl: 'http://127.0.0.1:8080/v1' })).toBeNull();
  });

  it('a request to test or list the models of any AI: the AI, and a key you typed, trimmed', () => {
    expect(AiCheckRequest.parse({ ai: bonsai })).toEqual({ ai: bonsai });
    expect(AiCheckRequest.parse({ ai: bonsai, key: '  sk-abc\n' }).key).toBe('sk-abc');
    expect(AiCheckRequest.safeParse({ ai: bonsai, key: '   ' }).success).toBe(false);
    expect(AiCheckRequest.safeParse({ ai: bonsai, key: 'k'.repeat(1001) }).success).toBe(false);
    expect(AiCheckRequest.safeParse({ ai: bonsai, save: true }).success).toBe(false);
    expect(AiModelsResult.parse({ ok: false, models: [], detail: 'No.' })).toEqual({ ok: false, models: [], detail: 'No.' });
  });
});

describe('contracts: job cards', () => {
  // A Seek card from a private advertiser: no company name.
  const card = {
    canonicalUrl: 'https://www.seek.com.au/job/81234567',
    sourceSite: 'seek',
    externalId: '81234567',
    title: 'Senior Engineer',
    company: null,
    location: 'Sydney NSW',
    text: 'Private advertiser. $150,000 - $170,000. Build developer tools in TypeScript.',
  };

  it('a Seek card with no company is fine', () => {
    expect(JobCard.safeParse(card).success).toBe(true);
  });

  it('a card needs a title', () => {
    expect(JobCard.safeParse({ ...card, title: '' }).success).toBe(false);
  });

  it("a card's text is 4000 characters at most", () => {
    expect(JobCard.safeParse({ ...card, text: 'x'.repeat(4000) }).success).toBe(true);
    expect(JobCard.safeParse({ ...card, text: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('quick ratings from cards have their own AI settings: short, with thinking off', () => {
    expect(activeAi(AiSettings.parse({})).tasks.card).toEqual({
      model: null,
      temperature: 0.2,
      maxTokens: 512,
      thinking: false,
      thinkingEffort: 'medium',
      extra: {},
    });
  });

  it('resumes and cover letters think with no limit by default: the AI decides', () => {
    expect(activeAi(AiSettings.parse({})).tasks.write).toMatchObject({ thinking: true, thinkingEffort: 'max', maxTokens: 8192 });
  });

  it('thinking can be low, medium, high or max, and an older "xhigh" is high', () => {
    for (const effort of ['low', 'medium', 'high', 'max']) {
      expect(activeAi(AiSettings.parse({ tasks: { rate: { thinkingEffort: effort } } })).tasks.rate.thinkingEffort).toBe(effort);
    }
    expect(activeAi(AiSettings.parse({ tasks: { rate: { thinkingEffort: 'xhigh' } } })).tasks.rate.thinkingEffort).toBe('high');
    expect(AiSettings.safeParse({ tasks: { rate: { thinkingEffort: 'extreme' } } }).success).toBe(false);
  });
});

describe('contracts: times', () => {
  it('a time with a time-zone offset is stored in UTC', () => {
    expect(IsoDateTime.parse('2026-10-28T14:15:00+11:00')).toBe('2026-10-28T03:15:00.000Z');
    expect(IsoDateTime.parse('2026-10-28T03:15:00.000Z')).toBe('2026-10-28T03:15:00.000Z');
    expect(IsoDateTime.safeParse('28/10/2026').success).toBe(false);
  });
});


describe('contracts: email', () => {
  it('an empty settings file gets the email defaults, with email off', () => {
    expect(Settings.parse({}).email).toEqual({
      enabled: false,
      address: '',
      host: 'imap.gmail.com',
      port: 993,
      mailbox: 'INBOX',
      pollMinutes: 10,
      firstCheckDays: 14,
      maxPerCheck: 100,
    });
  });

  it('checking more often than every 5 minutes is refused', () => {
    expect(Settings.safeParse({ email: { pollMinutes: 1 } }).success).toBe(false);
    expect(Settings.safeParse({ email: { pollMinutes: 5 } }).success).toBe(true);
  });

  it('checking less often than once a day is refused, so the timer never overflows', () => {
    expect(Settings.safeParse({ email: { pollMinutes: 1440 } }).success).toBe(true);
    expect(Settings.safeParse({ email: { pollMinutes: 100_000 } }).success).toBe(false);
  });

  it('reading emails has its own AI settings, with thinking off', () => {
    expect(activeAi(DEFAULT_SETTINGS.ai).tasks.email).toEqual({
      model: null,
      temperature: 0.1,
      maxTokens: 1024,
      thinking: false,
      thinkingEffort: 'medium',
      extra: {},
    });
  });
});

describe('contracts: follow-ups', () => {
  it('a reason of 200 characters is fine, and a longer one says so plainly', () => {
    expect(SetFollowUpRequest.safeParse({ on: '2026-11-05', note: 'x'.repeat(200) }).success).toBe(true);
    const long = SetFollowUpRequest.safeParse({ on: '2026-11-05', note: 'x'.repeat(201) });
    expect(long.success).toBe(false);
    expect(long.error?.issues[0]?.message).toBe('Keep the reason to 200 characters or fewer.');
  });
});

describe('contracts: the saved brief', () => {
  const story = { title: 'Moving to TypeScript', text: 'I moved the web app to TypeScript.' };
  const brief = {
    id: 1,
    jobId: 2,
    by: 'Bonsai 2',
    createdAt: '2026-11-03T01:00:00.000Z',
    updatedAt: '2026-11-03T01:00:00.000Z',
    approvedAt: null,
    contact: { name: null, email: null, recruiter: false, organisation: null },
    opening: { quote: 'Ship faster.', why: 'I cut build times.', inAd: true },
    needs: [{ need: 'TypeScript', stories: [story, story], chosen: 1, dropped: false }],
    gaps: [],
    questions: [],
  };

  it("refuses a need whose chosen story isn't one of its stories, or a need with no stories, but reads a brief with no needs", () => {
    expect(Brief.parse(brief).needs[0]!.chosen).toBe(1);
    expect(Brief.safeParse({ ...brief, needs: [{ ...brief.needs[0], chosen: 2 }] }).success).toBe(false);
    expect(Brief.safeParse({ ...brief, needs: [{ ...brief.needs[0], stories: [], chosen: 0 }] }).success).toBe(false);
    // The AI found none: it's saved as it is, and the page says so.
    expect(Brief.parse({ ...brief, needs: [] }).needs).toEqual([]);
  });

  it('takes only the edits you can make: trimmed, within their caps, and nothing else', () => {
    expect(BriefEdits.parse({ contact: { name: '  Alex  ', recruiter: true } })).toEqual({ contact: { name: 'Alex', recruiter: true } });
    expect(BriefEdits.safeParse({ contact: { name: 'Alex', recruiter: true, email: 'alex@example-recruit.com.au' } }).success).toBe(false);
    expect(BriefEdits.safeParse({ gaps: [] }).success).toBe(false);
    expect(BriefEdits.safeParse({ needs: [{ chosen: 3, dropped: false }] }).success).toBe(false);
    expect(BriefEdits.safeParse({ needs: Array(4).fill({ chosen: 0, dropped: false }) }).success).toBe(false);
    const answer = (text: string) => ({ questions: [{ answer: text, skipped: false, addToProfile: true }] });
    // 240 after trimming is fine; 241 is not.
    expect(BriefEdits.safeParse(answer(` ${'x'.repeat(240)} `)).success).toBe(true);
    expect(BriefEdits.safeParse(answer('x'.repeat(241))).success).toBe(false);
    // Up to 10 questions: your answers carried from the last brief, then the AI's new ones.
    const questions = (n: number) => ({ questions: Array(n).fill({ answer: null, skipped: false, addToProfile: false }) });
    expect(BriefEdits.safeParse(questions(10)).success).toBe(true);
    expect(BriefEdits.safeParse(questions(11)).success).toBe(false);
    // A saved brief is read whatever its number of questions.
    const many = Array(12).fill({ question: 'Q?', why: 'W.', answer: null, skipped: false, addToProfile: false, addedAt: null });
    expect(Brief.parse({ ...brief, questions: many }).questions).toHaveLength(12);
  });
});

describe('contracts: the saved prep plan', () => {
  const topic = {
    topic: 'Go basics',
    why: 'The ad lists Go.',
    steps: ['Read about Go types.', 'Rewrite a small script in Go.'],
    hours: 4,
    afterwards: "I've learnt Go's basics.",
  };
  const plan = {
    id: 4,
    jobId: 2,
    by: 'Bonsai 2',
    createdAt: '2026-11-03T01:00:00.000Z',
    learn: [topic],
    project: { title: 'A build-time dashboard', what: 'A small app.', touches: ['Go'], hours: 6, afterwards: 'I built a small tool.' },
    interview: [],
    ask: [],
    refresh: [],
  };

  it('reads a topic left with one step or none, and takes one from the AI too: its 2 to 4 is only asked for', () => {
    for (const steps of [[], ['Do the Go tour.']]) {
      expect(PrepPlan.parse({ ...plan, learn: [{ ...topic, steps }] }).learn[0]!.steps).toEqual(steps);
      expect(PrepAnswer.parse({ ...plan, learn: [{ ...topic, steps }] }).learn[0]!.steps).toEqual(steps);
    }
    // And a plan with empty lists, or none made by a known AI.
    expect(PrepPlan.parse({ ...plan, learn: [], by: null }).learn).toEqual([]);
    expect(PrepPlan.safeParse({ ...plan, createdAt: 'yesterday' }).success).toBe(false);
  });
});
