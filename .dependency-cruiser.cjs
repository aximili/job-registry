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
      name: 'core-not-modules',
      severity: 'error',
      comment: 'core is the base that every module builds on. It never reaches up into a module.',
      from: { path: '^server/core/' },
      to: { path: '^server/modules/' },
    },
    {
      name: 'only-app-wires-modules',
      severity: 'error',
      comment:
        'Only server/app.ts builds modules and adapters (R8). Another module may be imported for its types only; its service arrives as an argument.',
      from: { path: '^server/modules/([^/]+)/', pathNot: TEST_FILE },
      to: { path: '^server/modules/', pathNot: '^server/modules/$1/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'main-uses-app',
      severity: 'error',
      comment: 'main.ts starts the app through app.ts, the one place that wires modules together.',
      from: { path: '^server/main\\.ts$' },
      to: { path: '^server/modules/' },
    },
    {
      name: 'no-sql-in-services',
      severity: 'error',
      comment: 'Services know nothing about SQL. Database helpers belong in repo.ts.',
      from: { path: '^server/modules/[^/]+/service\\.ts$' },
      to: { path: '^server/core/db/', dependencyTypesNot: ['type-only'] },
    },
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
      name: 'only-background-calls-server',
      severity: 'error',
      comment:
        "In the extension, only the background script talks to the app (architecture §11). Content scripts run inside job sites, where the browser's cross-site rules apply.",
      from: { path: '^extension/src/', pathNot: ['^extension/src/(background|handlers)\\.ts$', TEST_FILE] },
      to: { path: '^shared/api-client\\.ts$', dependencyTypesNot: ['type-only'] },
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
      comment: 'Module logic uses the port. Only index.ts exposes adapters and runtimes, for app.ts to wire.',
      from: {
        path: '^server/modules/([^/]+)/',
        pathNot: ['^server/modules/[^/]+/index\\.ts$', '/(adapters|runtime)/', TEST_FILE],
      },
      to: { path: '^server/modules/$1/(adapters|runtime)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|node_modules)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
