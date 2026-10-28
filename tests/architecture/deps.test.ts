// Checks the architecture rules (docs/architecture.md §15) on the real code,
// and proves on small throwaway trees that each key rule really fails.

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cruise } from 'dependency-cruiser';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = require(join(root, '.dependency-cruiser.cjs')) as {
  forbidden: unknown[];
  options: Record<string, unknown>;
};

async function violations(baseDir: string, paths: string[]): Promise<string[]> {
  const { tsConfig: _ignored, ...options } = config.options;
  const result = await cruise(paths, {
    ...options,
    baseDir,
    validate: true,
    ruleSet: { forbidden: config.forbidden } as never,
  });
  const output = result.output as { summary: { violations: { rule: { name: string } }[] } };
  return output.summary.violations.map((v) => v.rule.name);
}

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  // realpath: on macOS the temp folder is a symlink, and the cruiser
  // compares resolved paths against the real one.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'jr-deps-')));
  temps.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

const jobsModule = {
  'server/modules/jobs/index.ts': 'export const jobs = 1;\n',
  'server/modules/jobs/repo.ts': 'export const repo = 1;\n',
};

describe('architecture rules', () => {
  it('the real codebase has no violations', async () => {
    const paths = ['server', 'shared', 'web/src'].filter((p) => existsSync(join(root, p)));
    expect(await violations(root, paths)).toEqual([]);
  });

  it('flags a foundation module importing another module', async () => {
    const dir = tree({
      ...jobsModule,
      'server/modules/ai/service.ts': "import { jobs } from '../jobs/index.ts';\nexport const ai = jobs;\n",
    });
    expect(await violations(dir, ['server'])).toContain('foundation-no-module-deps');
  });

  it('flags importing another module’s private file', async () => {
    const dir = tree({
      ...jobsModule,
      'server/modules/search/service.ts': "import { repo } from '../jobs/repo.ts';\nexport const search = repo;\n",
    });
    expect(await violations(dir, ['server'])).toContain('module-private');
  });

  it('flags a composite module outside its allow-list', async () => {
    const dir = tree({
      ...jobsModule,
      'server/modules/ratings/service.ts': "import { jobs } from '../jobs/index.ts';\nexport const ratings = jobs;\n",
    });
    expect(await violations(dir, ['server'])).toContain('composite-allow-list-ratings');
  });

  it('flags shared importing server code', async () => {
    const dir = tree({
      'server/app.ts': 'export const app = 1;\n',
      'shared/x.ts': "import { app } from '../server/app.ts';\nexport const x = app;\n",
    });
    expect(await violations(dir, ['server', 'shared'])).toContain('shared-is-leaf');
  });
});
