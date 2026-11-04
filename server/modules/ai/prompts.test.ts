import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fillPrompt, loadPrompt, PROMPTS_DIR } from './prompts.ts';

const dir = fileURLToPath(new URL('./prompts/', import.meta.url));

// What each task fills in. A prompt asking for anything else would fail at run time.
const VALUES: Record<string, string[]> = {
  'parse-job': ['today', 'ad'],
  'rate-job': ['profile', 'preferences', 'ad'],
  'rate-card': ['profile', 'preferences', 'card'],
  'write-resume': ['profile', 'job', 'notes', 'brief', 'guide', 'ad'],
  'write-cover-letter': ['profile', 'today', 'job', 'notes', 'brief', 'guide', 'ad'],
  'make-brief': ['profile', 'today', 'job', 'notes', 'answers', 'ad'],
  'make-prep': ['profile', 'today', 'job', 'notes', 'brief', 'ad'],
  'classify-email': ['candidates', 'from', 'subject', 'date', 'email'],
};

// What each prompt ends with: the long, changing part, so the fixed part can be cached.
const LAST: Record<string, string> = { 'classify-email': '{{email}}', 'rate-card': '{{card}}' };

// The tasks that run on the writing AI.
const WRITING = ['make-brief', 'make-prep', 'write-resume', 'write-cover-letter'];

describe('prompts', () => {
  it('every prompt file has a system part and a user part, and every placeholder is filled', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    expect(files.sort()).toEqual(Object.keys(VALUES).map((n) => `${n}.md`).sort());
    for (const file of files) {
      const name = file.replace(/\.md$/, '');
      const prompt = loadPrompt(dir, name);
      expect(prompt.system.trim().length).toBeGreaterThan(50);
      expect(prompt.user.trim().length).toBeGreaterThan(0);
      const used = [...readFileSync(`${dir}${file}`, 'utf8').matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      expect([...new Set(used)].sort()).toEqual([...VALUES[name]!].sort());
    }
  });

  it('the ad, the card or the email comes last in every prompt', () => {
    for (const name of Object.keys(VALUES)) {
      const { user } = loadPrompt(dir, name);
      expect(user.trim().endsWith(LAST[name] ?? '{{ad}}')).toBe(true);
    }
  });

  // So llama-server's cache serves both: moving between a full rating and
  // quick marks doesn't read the whole profile again.
  it('the two rating prompts share their system part word for word', () => {
    const job = loadPrompt(PROMPTS_DIR, 'rate-job');
    const card = loadPrompt(PROMPTS_DIR, 'rate-card');
    expect(job.system).toBe(card.system);
    expect(job.system).toContain('{{profile}}');
    expect(job.system).toContain('{{preferences}}');
    expect(job.system).not.toContain('{{ad}}');
    expect(job.system).not.toContain('{{card}}');
  });

  // So llama-server's cache of the profile (most of a minute on Bonsai 2)
  // serves the brief, the letter, the resume and the prep plan alike.
  it('the four writing prompts share their system part word for word: the rules and the profile', () => {
    const [first, ...rest] = WRITING.map((name) => loadPrompt(PROMPTS_DIR, name));
    for (const prompt of rest) expect(prompt.system).toBe(first!.system);
    expect(first!.system).toContain('{{profile}}');
    // My notes and answers are facts from me too: they may give a number, and settle a ⚠ item.
    expect(first!.system).toContain("never add a number that my profile, my notes or my answers don't have");
    expect(first!.system).toContain('use its conservative value, unless my answers or notes settle it');
    for (const other of ['{{ad}}', '{{guide}}', '{{notes}}', '{{brief}}', '{{answers}}', '{{preferences}}']) {
      expect(first!.system).not.toContain(other);
    }
  });

  it('every writing prompt gives the notes, and the two write prompts and the prep plan give the brief', () => {
    for (const name of WRITING) {
      const { user } = loadPrompt(PROMPTS_DIR, name);
      expect(user).toContain('{{notes}}');
      // The email reader's notes are about the job, not about me.
      // Notes print as "4 Nov 2026: Email, …", so the rule looks past the date.
      expect(user, name).toContain('A note whose text, after its date, starts "Email," sums up an email I got: true about the job, but not facts about me or my wishes.');
    }
    for (const name of ['write-resume', 'write-cover-letter', 'make-prep']) expect(loadPrompt(PROMPTS_DIR, name).user).toContain('{{brief}}');
    expect(loadPrompt(PROMPTS_DIR, 'make-brief').user).toContain('{{answers}}');
  });

  // The brief's questions aim at "To confirm" and ⚠ items, so an answer must
  // win over the guide's "follow my profile's rules" line. The brief itself
  // is the AI's plan from my profile, not facts from me: a story's facts must
  // be in my profile, my notes or my answers.
  it('the two write prompts let my answers settle a "To confirm" or ⚠ item, never a "Don\'t claim" item, and the resume still plans with a brief', () => {
    for (const name of ['write-resume', 'write-cover-letter']) {
      const { user } = loadPrompt(PROMPTS_DIR, name);
      expect(user).toContain('My answers, and my notes (but not a note whose text, after its date, starts "Email,"), are facts from me, even where my guide says to use only my profile.');
      expect(user).toContain('My answers settle any "To confirm" or ⚠ item they answer, but never a "Don\'t claim" item.');
      expect(user).toContain('The brief is my plan, and its stories come from my profile: every fact in a story must also be in my profile, my notes or my answers.');
      expect(user).not.toContain('the brief are facts from me');
    }
    // The resume guide's Step 1 maps the ad's key words; the brief has none.
    expect(loadPrompt(PROMPTS_DIR, 'write-resume').user).toContain('use its needs, stories and answers in your plan, not in place of it');
  });

  // The service takes out any link too, as a safety net.
  it('the brief and the prep plan ask for no links or web addresses', () => {
    for (const name of ['make-brief', 'make-prep']) expect(loadPrompt(PROMPTS_DIR, name).user, name).toContain('- No links or web addresses');
  });

  it('fillPrompt refuses a missing value', () => {
    expect(fillPrompt('Hi {{name}}', { name: 'Sam' })).toBe('Hi Sam');
    expect(() => fillPrompt('Hi {{name}}', {})).toThrow('Prompt placeholder {{name}} has no value');
  });

  it('a value with $ or {{ }} in it is inserted as it is', () => {
    expect(fillPrompt('Pay: {{ad}}', { ad: '$100k {{not a placeholder}} $&' })).toBe('Pay: $100k {{not a placeholder}} $&');
  });
});
