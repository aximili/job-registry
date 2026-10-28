// The composition root: the only place that creates modules and connects
// them. Wiring order follows docs/architecture.md §4.4. Tests build this
// same app with fakes and an in-memory database.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { localDate } from '../shared/dates.ts';
import type { AppPaths, Clock } from './core/config.ts';
import { openDb, type Db } from './core/db/db.ts';
import { createEventBus, type EventBus } from './core/events.ts';
import { registerErrorHandler } from './core/http/errors.ts';
import { registerSecurity } from './core/http/security.ts';
import { serveDashboard } from './core/http/static.ts';
import { createLogger, type Logger } from './core/logger.ts';
import { createCallsheetModule, type CallsheetService } from './modules/callsheet/index.ts';
import { createCaptureModule, type CaptureService } from './modules/capture/index.ts';
import { createContactsModule, type ContactsService } from './modules/contacts/index.ts';
import { createJobsModule, type JobsService } from './modules/jobs/index.ts';
import { createLiveModule, type LiveService } from './modules/live/index.ts';
import { createNotesModule, type NotesService } from './modules/notes/index.ts';
import { createSearchModule, type SearchService } from './modules/search/index.ts';
import { createSettingsModule, type SettingsService } from './modules/settings/index.ts';
import { createSystemModule, type SystemService } from './modules/system/index.ts';

export type AppOptions = {
  paths: AppPaths;
  port?: number;
  logger?: Logger;
  now?: Clock;
  fetch?: typeof fetch;
  onShutdown?: () => void;
  version?: string;
};

export type AppServices = {
  settings: SettingsService;
  system: SystemService;
  capture: CaptureService;
  jobs: JobsService;
  notes: NotesService;
  contacts: ContactsService;
  search: SearchService;
  callsheet: CallsheetService;
  live: LiveService;
};

export type App = {
  http: FastifyInstance;
  db: Db;
  bus: EventBus;
  port: number;
  services: AppServices;
  close(): Promise<void>;
};

export async function buildApp(opts: AppOptions): Promise<App> {
  const logger = opts.logger ?? createLogger({ dir: null });
  const now = opts.now ?? (() => new Date());
  const bus = createEventBus(logger);

  const settings = createSettingsModule({ file: opts.paths.settings, bus });
  const port = opts.port ?? settings.service.get().server.port;
  const backupDir = () => resolve(opts.paths.root, settings.service.get().backups.dir);

  if (opts.paths.db !== ':memory:') mkdirSync(dirname(opts.paths.db), { recursive: true });
  const db = openDb(opts.paths.db, {
    onBeforeMigrate: (current) => {
      // A full copy before changing the shape of a database that holds your data.
      const dir = backupDir();
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `jobs-before-upgrade-${localDate(now())}-${now().getTime()}.db`), current.serialize());
    },
  });

  const system = createSystemModule({
    db,
    backupDir,
    keepBackups: () => settings.service.get().backups.keep,
    now,
    version: opts.version ?? '0.0.0',
    logger,
    onShutdown: opts.onShutdown ?? (() => {}),
  });
  const capture = createCaptureModule({ fetch: opts.fetch, now });
  const jobs = createJobsModule({ db, bus, statuses: () => settings.service.statuses(), now });
  const notes = createNotesModule({ db, bus, now });
  const contacts = createContactsModule({ db, bus, now });
  const search = createSearchModule({
    db,
    bus,
    jobs: jobs.service,
    contacts: contacts.service,
    notes: notes.service,
    statuses: () => settings.service.statuses(),
  });
  const callsheet = createCallsheetModule({ jobs: jobs.service, contacts: contacts.service, notes: notes.service });
  const live = createLiveModule({ bus });

  const http: FastifyInstance = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    logController: new LogController({ disableRequestLogging: true }),
    // Live-event connections stay open, so closing must not wait for them.
    forceCloseConnections: true,
  });
  registerSecurity(http, { port });
  registerErrorHandler(http, logger);
  for (const module of [settings, system, capture, jobs, notes, contacts, search, callsheet, live]) {
    await http.register(module.routes, { prefix: '/api/v1' });
  }
  await serveDashboard(http, opts.paths.webDist);

  return {
    http,
    db,
    bus,
    port,
    services: { settings: settings.service, system: system.service, capture: capture.service, jobs: jobs.service, notes: notes.service,
      contacts: contacts.service,
      search: search.service,
      callsheet: callsheet.service,
      live: live.service,
    },
    async close() {
      await http.close();
      db.close();
    },
  };
}
