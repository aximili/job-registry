import { join } from 'node:path';

// Where everything lives on disk. All paths are absolute. db may be ':memory:' in tests.
export type AppPaths = {
  root: string;
  data: string;
  db: string;
  files: string;
  logs: string;
  config: string;
  settings: string;
  secrets: string;
  profile: string;
  templates: string;
  webDist: string;
};

export type Clock = () => Date;

export function resolvePaths(root: string, overrides: Partial<AppPaths> = {}): AppPaths {
  const data = overrides.data ?? join(root, 'data');
  const config = overrides.config ?? join(root, 'config');
  return {
    root,
    data,
    db: join(data, 'jobs.db'),
    files: join(data, 'files'),
    logs: join(data, 'logs'),
    config,
    settings: join(config, 'settings.json'),
    secrets: join(config, 'secrets.json'),
    profile: join(root, 'profile'),
    templates: join(root, 'templates'),
    webDist: join(root, 'web', 'dist'),
    ...overrides,
  };
}
