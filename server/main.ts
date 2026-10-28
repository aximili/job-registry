// Starts Job Registry: `node server/main.ts` (start.bat does this for you).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, type App } from './app.ts';
import { resolvePaths } from './core/config.ts';
import { describeListenError } from './core/http/listen-error.ts';
import { createLogger, pruneLogs } from './core/logger.ts';
import { clearStartupError, installProcessHandlers, writeStartupError } from './core/process.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const paths = resolvePaths(root);
const logger = createLogger({ dir: paths.logs });
pruneLogs(paths.logs, 14, new Date());

const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;
const dbExisted = existsSync(paths.db);

// Stops with a message you can read: in the log, and in the file start.bat shows.
function failToStart(message: string): never {
  logger.error(message);
  writeStartupError(paths.logs, message);
  process.exit(1);
}

let app: App;
try {
  app = await buildApp({ paths, logger, version, onShutdown: () => void stop() });
} catch (err) {
  failToStart((err as Error).message);
}

try {
  await app.http.listen({ host: '127.0.0.1', port: app.port });
} catch (err) {
  failToStart(describeListenError(err as NodeJS.ErrnoException, app.port));
}
clearStartupError(paths.logs);
logger.info(`Job Registry is running at http://127.0.0.1:${app.port}/`);

if (dbExisted) {
  app.services.system.backupNow().catch((err: unknown) => logger.error({ err }, 'The start-up backup failed'));
}
const stopBackups = app.services.system.startDailyBackups();
app.startBackgroundWork();

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info('Job Registry is stopping');
  stopBackups();
  await app.close();
  process.exit(0);
}
installProcessHandlers(process, { stop, logger, onExit: () => app.stopChildrenNow() });
