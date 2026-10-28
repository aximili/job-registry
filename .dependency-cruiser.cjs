// Architecture rules for Job Registry. The reasons are in
// docs/architecture.md §4.2 (allowed dependencies) and §15 (the rules).
// Never weaken a rule to make the check pass. Fix the import instead.

/** Modules that may not depend on any other module. */
const FOUNDATION = ['jobs', 'contacts', 'notes', 'ai', 'profile', 'capture', 'settings', 'system', 'live'];

/** Composite modules, and the only modules each one may call. */
const COMPOSITE = {
  ratings: ['ai', 'profile'],
  enrich: ['jobs', 'ai', 'ratings'],
  documents: ['ai', 'profile', 'jobs'],
  search: ['jobs', 'contacts', 'notes'],
  callsheet: ['jobs', 'contacts', 'notes', 'documents'],
  email: ['ai', 'jobs', 'contacts', 'notes'],
};

const TEST_FILE = '\\.test\\.ts$';

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Import cycles make it impossible to change one part on its own.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'module-private',
      severity: 'error',
      comment: 'Other modules may use a module only through its index.ts.',
      from: { path: '^server/modules/([^/]+)/' },
      to: {
        path: '^server/modules/[^/]+/',
        pathNot: ['^server/modules/$1/', '^server/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'foundation-no-module-deps',
      severity: 'error',
      comment: 'Foundation modules stand alone. They get what they need from app.ts.',
      from: { path: `^server/modules/(${FOUNDATION.join('|')})/` },
      to: { path: '^server/modules/', pathNot: '^server/modules/$1/' },
    },
    ...Object.entries(COMPOSITE).map(([name, allowed]) => ({
      name: `composite-allow-list-${name}`,
      severity: 'error',
      comment: `${name} may only call: ${allowed.join(', ')}.`,
      from: { path: `^server/modules/${name}/` },
      to: { path: '^server/modules/', pathNot: `^server/modules/(${[name, ...allowed].join('|')})/` },
    })),
    {
      name: 'no-fastify-in-logic',
      severity: 'error',
      comment: 'Services and repos know nothing about HTTP. Fastify stays in routes.ts.',
      from: { path: '^server/modules/[^/]+/(service|repo)\\.ts$' },
      to: { path: '(^|/)node_modules/(fastify|@fastify)/' },
    },
    {
      name: 'sqlite-only-in-repos',
      severity: 'error',
      comment: 'Only repo.ts files and core/db talk to SQLite.',
      from: { path: '^server/', pathNot: ['repo\\.ts$', '^server/core/db/', TEST_FILE] },
      to: { path: '(^|/)node_modules/better-sqlite3/' },
    },
    {
      name: 'shared-is-leaf',
      severity: 'error',
      comment: 'shared/ is used by the server, dashboard and extension, so it imports none of them.',
      from: { path: '^shared/' },
      to: { path: '^(server|web|extension)/' },
    },
    {
      name: 'shared-npm-allow-list',
      severity: 'error',
      comment: 'shared/ runs in browsers too. It may only use zod and marked.',
      from: { path: '^shared/', pathNot: TEST_FILE },
      to: { path: '(^|/)node_modules/', pathNot: '(^|/)node_modules/(zod|marked)/' },
    },
    {
      name: 'shared-no-node-builtins',
      severity: 'error',
      comment: 'shared/ runs in browsers too, so no Node built-ins.',
      from: { path: '^shared/', pathNot: TEST_FILE },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'clients-not-server',
      severity: 'error',
      comment: 'The dashboard and extension talk to the server over HTTP only.',
      from: { path: '^(web|extension)/' },
      to: { path: '^server/' },
    },
    {
      name: 'adapters-only-from-index',
      severity: 'error',
      comment: 'Module logic uses the port. Only index.ts exposes adapters, for app.ts to wire.',
      from: {
        path: '^server/modules/([^/]+)/',
        pathNot: ['^server/modules/[^/]+/index\\.ts$', '/adapters/', TEST_FILE],
      },
      to: { path: '^server/modules/$1/adapters/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|node_modules)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
