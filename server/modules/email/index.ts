import type { HttpModule } from '../../core/http/module.ts';
import type { Db } from '../../core/db/db.ts';
import { createEmailRepo } from './repo.ts';
import { emailRoutes } from './routes.ts';
import { createEmailService, type EmailOptions, type EmailService } from './service.ts';

export type { EmailService };
export type { MailCursor, MailMessage, MailSource } from './mail-source.ts';
// The adapter, for app.ts to wire. Nothing else imports it.
export { createImapMailSource, type ImapConfig } from './adapters/imap.ts';

export function createEmailModule(opts: Omit<EmailOptions, 'repo'> & { db: Db }): HttpModule<EmailService> {
  const { db, ...rest } = opts;
  const service = createEmailService({ ...rest, repo: createEmailRepo(db) });
  return { service, routes: emailRoutes(service) };
}
