// The composition root: the only place that creates modules and connects
// them. Wiring order follows docs/architecture.md §4.4. Tests build this
// same app with fakes and an in-memory database.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { localDate } from '../shared/dates.ts';
import type { AppPaths, Clock } from './core/config.ts';
import { openDb, type Db } from './core/db/db.ts';
import { createEventBus, type EventBus } from './core/events.ts';
import { registerErrorHandler } from './core/http/errors.ts';
import { registerSecurity } from './core/http/security.ts';
import { serveDashboard } from './core/http/static.ts';
import { createLogger, type Logger } from './core/logger.ts';
import {
  createAiModule,
  createLlamaServerRuntime,
  createNoopRuntime,
  createOpenAiCompatibleProvider,
  type AiProvider,
  type AiService,
  type ModelRuntime,
} from './modules/ai/index.ts';
import { createCallsheetModule, type CallsheetService } from './modules/callsheet/index.ts';
import { createCaptureModule, type CaptureService } from './modules/capture/index.ts';
import { createContactsModule, type ContactsService } from './modules/contacts/index.ts';
import {
  createDocumentsModule,
  createDocxExporter,
  createPrintHtmlExporter,
  type DocumentsService,
} from './modules/documents/index.ts';
import { createEnrichModule, type EnrichService } from './modules/enrich/index.ts';
import { createJobsModule, type JobsService } from './modules/jobs/index.ts';
import { createLiveModule, type LiveService } from './modules/live/index.ts';
import { createNotesModule, type NotesService } from './modules/notes/index.ts';
import { createProfileModule, type ProfileService } from './modules/profile/index.ts';
import { createRatingsModule, type RatingsService } from './modules/ratings/index.ts';
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

// The starter guides and templates that come with the app, copied in when one is missing.
const STARTERS_DIR = fileURLToPath(new URL('../starters/', import.meta.url));

// Stand-ins for the outside world, for tests.
export type Fakes = { ai: AiProvider; runtime: ModelRuntime };

export type AppServices = {
  settings: SettingsService;
  profile: ProfileService;
  documents: DocumentsService;
  ai: AiService;
  ratings: RatingsService;
  enrich: EnrichService;
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
  // After the server is listening: reads ads still waiting from before.
  startBackgroundWork(): void;
  // For a crash or exit: ends the AI program the app started, at once.
  stopChildrenNow(): void;
  close(): Promise<void>;
};

export async function buildApp(opts: AppOptions, fakes: Partial<Fakes> = {}): Promise<App> {
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
    filesDir: opts.paths.files,
    profileDir: opts.paths.profile,
    templatesDir: opts.paths.templates,
    keepBackups: () => settings.service.get().backups.keep,
    now,
    version: opts.version ?? '0.0.0',
    logger,
    onShutdown: opts.onShutdown ?? (() => {}),
  });
  const capture = createCaptureModule({ fetch: opts.fetch, now });

  // The AI: one provider for every OpenAI-style server. The runtime is the
  // llama-server the app manages, or a check on a server you run yourself.
  const aiConfig = () => settings.service.get().ai;
  const provider =
    fakes.ai ??
    createOpenAiCompatibleProvider(() => {
      const c = aiConfig();
      return { baseUrl: c.baseUrl, model: c.model, timeoutSec: c.timeoutSec };
    });
  const managedRuntime = createLlamaServerRuntime({ root: opts.paths.root, logFile: join(opts.paths.logs, 'llama.log'), getConfig: aiConfig });
  const externalRuntime = createNoopRuntime(provider, aiConfig);
  const runtime = (): ModelRuntime => {
    if (fakes.runtime) return fakes.runtime;
    const c = aiConfig();
    return c.preset === 'llama-server' && c.managed.enabled ? managedRuntime : externalRuntime;
  };
  const ai = createAiModule({ provider, runtime, getConfig: aiConfig, bus, logger, now });
  const profile = createProfileModule({ dir: opts.paths.profile, templatesDir: opts.paths.templates, startersDir: STARTERS_DIR, bus, now });
  const installed = profile.service.installStarters();
  if (installed.length > 0) logger.info(`Added starter files: ${installed.join(', ')}`);
  const ratings = createRatingsModule({ db, ai: ai.service, profile: profile.service, now });
  const jobs = createJobsModule({ db, bus, statuses: () => settings.service.statuses(), now });
  const notes = createNotesModule({ db, bus, now });
  const contacts = createContactsModule({ db, bus, now });
  const enrich = createEnrichModule({ bus, jobs: jobs.service, ai: ai.service, ratings: ratings.service, logger });
  const documents = createDocumentsModule({
    db,
    bus,
    now,
    ai: ai.service,
    profile: profile.service,
    jobs: jobs.service,
    exporters: [createPrintHtmlExporter(), createDocxExporter()],
    filesDir: opts.paths.files,
  });
  const search = createSearchModule({
    db,
    bus,
    jobs: jobs.service,
    contacts: contacts.service,
    notes: notes.service,
    statuses: () => settings.service.statuses(),
  });
  const callsheet = createCallsheetModule({
    jobs: jobs.service,
    contacts: contacts.service,
    notes: notes.service,
    documents: documents.service,
  });
  const live = createLiveModule({ bus });

  const http: FastifyInstance = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    logController: new LogController({ disableRequestLogging: true }),
    // Live-event connections stay open, so closing must not wait for them.
    forceCloseConnections: true,
  });
  registerSecurity(http, { port });
  registerErrorHandler(http, logger);
  for (const module of [settings, system, capture, ai, profile, ratings, jobs, enrich, notes, contacts, documents, search, callsheet, live]) {
    await http.register(module.routes, { prefix: '/api/v1' });
  }
  await serveDashboard(http, opts.paths.webDist);

  return {
    http,
    db,
    bus,
    port,
    services: {
      settings: settings.service,
      profile: profile.service,
      documents: documents.service,
      ai: ai.service,
      ratings: ratings.service,
      enrich: enrich.service,
      system: system.service,
      capture: capture.service,
      jobs: jobs.service,
      notes: notes.service,
      contacts: contacts.service,
      search: search.service,
      callsheet: callsheet.service,
      live: live.service,
    },
    stopChildrenNow() {
      ai.service.stopNow();
    },
    startBackgroundWork() {
      const waiting = enrich.service.sweep();
      if (waiting > 0) logger.info(`Reading ${waiting} saved ads with the AI, one at a time`);
    },
    async close() {
      // AI work first, so nothing writes to the database after it closes,
      // and a llama-server the app started is never left running.
      await ai.service.stop().catch((err: unknown) => logger.error({ err }, 'Stopping the AI failed'));
      await enrich.service.onIdle();
      await http.close();
      db.close();
    },
  };
}
