// You commit by hand, so a source file that git ignores would silently be
// left out, and the app wouldn't start on another PC. These checks only read.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const ignored = (path: string): boolean => {
  try {
    git('check-ignore', '-q', '--no-index', path);
    return true;
  } catch {
    return false;
  }
};

describe('.gitignore', () => {
  it('never hides source code', () => {
    const hidden = git('ls-files', '--others', '--ignored', '--exclude-standard', 'server', 'shared', 'web/src', 'tests', 'scripts', 'extension/src')
      .split('\n')
      .filter(Boolean)
      .filter((p) => !p.startsWith('tests/e2e/test-results'));
    expect(hidden).toEqual([]);
    expect(ignored('server/modules/ai/service.ts')).toBe(false);
  });

  it('still hides your data, settings and the AI downloads', () => {
    // Your profile holds your work history and salary floor: never in a commit.
    for (const path of [
      'data/jobs.db',
      'config/settings.json',
      'config/secrets.json',
      'ai/models/model.gguf',
      'ai/llama.cpp/llama-server.exe',
      'profile/master-profile.md',
      'profile/preferences.md',
      'extension/dist/firefox/manifest.json',
    ]) {
      expect(ignored(path), path).toBe(true);
    }
  });
});
