import { join } from 'node:path';
import { expect, it } from 'vitest';
import { resolvePaths } from './config.ts';

it('resolvePaths builds every path from the root and applies overrides', () => {
  const root = join('/', 'apps', 'job-registry');
  expect(resolvePaths(root)).toEqual({
    root,
    data: join(root, 'data'),
    db: join(root, 'data', 'jobs.db'),
    files: join(root, 'data', 'files'),
    logs: join(root, 'data', 'logs'),
    config: join(root, 'config'),
    settings: join(root, 'config', 'settings.json'),
    secrets: join(root, 'config', 'secrets.json'),
    profile: join(root, 'profile'),
    templates: join(root, 'templates'),
    webDist: join(root, 'web', 'dist'),
  });
  expect(resolvePaths(root, { db: ':memory:' }).db).toBe(':memory:');
});
