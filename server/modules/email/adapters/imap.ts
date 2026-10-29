// Reads Gmail over IMAP with an app password (decision 0008), using imapflow.
// The mailbox is opened read-only, so nothing is ever marked read, moved or
// deleted. Each fetch logs in, reads, and logs out again. imapflow's own
// logging is off, so no email text can reach a log.

import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from 'imapflow';
import { htmlFragmentToText, normaliseText } from '../../../core/html-text.ts';
import type { FetchOptions, MailCursor, MailMessage, MailSource } from '../mail-source.ts';

export type ImapConfig = {
  host: string;
  port: number;
  address: string;
  password: string | null;
  mailbox: string;
  // Gmail always uses TLS. Tests turn it off for a local test server.
  secure?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const TEXT_BYTES = 65_536;

const WRONG_PASSWORD =
  'Gmail refused the address or app password. Check both in Settings → Email. An app password is 16 letters, made at myaccount.google.com/apppasswords.';
const BAD_CERTIFICATE = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);
// What Gmail says to a wrong address or password, or to a normal password where an app password is needed.
const BAD_PASSWORD_TEXT = /invalid credentials|application-specific password|username and password not accepted|authentication failed/i;
const CANT_CONNECT = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
  'CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT', 'ETIMEOUT', 'NoConnection', 'EConnectionClosed',
]);

type ImapError = Error & { code?: string; authenticationFailed?: boolean; serverResponseCode?: string; responseText?: string };

// Every failure becomes one sentence you can act on.
export function explainImapError(err: unknown, config: ImapConfig): Error {
  const e = err as ImapError;
  if (e?.name === 'AbortError') return e;
  if (e?.authenticationFailed) {
    const text = (e.responseText ?? '').trim();
    // imapflow marks every refused login; only some of them are about the password.
    if (e.serverResponseCode === 'AUTHENTICATIONFAILED' || !text || BAD_PASSWORD_TEXT.test(text)) return new Error(WRONG_PASSWORD);
    return new Error(`Gmail refused the login: ${text}`);
  }
  if (e?.code && BAD_CERTIFICATE.has(e.code)) {
    return new Error(
      `Can't check ${config.host}'s certificate. Antivirus software that scans email often swaps it. Turn off its email or encrypted-connection scanning for Job Registry, then try again.`,
    );
  }
  if (e?.serverResponseCode === 'NONEXISTENT' || /doesn'?t exist|does not exist|unknown mailbox/i.test(e?.responseText ?? '')) {
    return new Error(`Gmail has no mailbox called ${config.mailbox}.`);
  }
  if (e?.code && CANT_CONNECT.has(e.code)) return new Error(`Can't reach ${config.host}. Check your internet connection.`);
  const said = (e?.responseText || e?.message || 'no reason given').trim();
  return new Error(`Gmail said: ${said}`);
}

function checkConfig(config: ImapConfig): void {
  if (!config.address.trim()) throw new Error('Add your Gmail address first: Settings → Email.');
  if (!config.password?.trim()) throw new Error('Add your Gmail app password first: Settings → Email.');
}

// The part to read: plain text if there is some, else HTML. Attachments and
// attached emails are skipped.
function textPart(node: MessageStructureObject): { part: string; html: boolean } | null {
  let html: { part: string; html: boolean } | null = null;
  const walk = (n: MessageStructureObject): { part: string; html: boolean } | null => {
    if (n.disposition === 'attachment' || n.type === 'message/rfc822') return null;
    if (n.childNodes?.length) {
      for (const child of n.childNodes) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }
    const part = n.part ?? '1';
    if (n.type === 'text/plain') return { part, html: false };
    if (n.type === 'text/html' && !html) html = { part, html: true };
    return null;
  };
  return walk(node) ?? html;
}

async function readText(client: ImapFlow, uid: number, structure: MessageStructureObject | undefined): Promise<string> {
  const choice = structure ? textPart(structure) : null;
  if (!choice) return '';
  const { content } = await client.download(String(uid), choice.part, { uid: true, maxBytes: TEXT_BYTES });
  if (!content) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of content) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  const text = Buffer.concat(chunks).toString('utf8');
  return choice.html ? htmlFragmentToText(text) : normaliseText(text);
}

function toMessage(m: FetchMessageObject, text: string, uidValidity: string, now: Date): MailMessage {
  const from = m.envelope?.from?.[0];
  // A date that can't be read becomes the time the app read the email.
  const date = m.internalDate ? new Date(m.internalDate) : null;
  const received = date && !Number.isNaN(date.getTime()) ? date : now;
  return {
    id: m.envelope?.messageId?.trim() || `uid:${uidValidity}:${m.uid}`,
    from: (from?.address ?? '').toLowerCase(),
    fromName: from?.name?.trim() || null,
    to: m.envelope?.to?.[0]?.address ?? '',
    subject: m.envelope?.subject ?? '',
    receivedAt: received.toISOString(),
    text,
    after: { uidValidity, lastUid: m.uid },
  };
}

const HEADERS = { uid: true, envelope: true, bodyStructure: true, internalDate: true } as const;

// The headers of a batch, oldest first. When Gmail refuses the batch (say,
// "Some messages could not be FETCHed"), each email is asked for on its own,
// and one that still fails is left out.
async function fetchHeaders(client: ImapFlow, uids: number[]): Promise<FetchMessageObject[]> {
  const one = async (range: number[]): Promise<FetchMessageObject[]> => {
    const out: FetchMessageObject[] = [];
    for await (const m of client.fetch(range, HEADERS, { uid: true })) out.push(m);
    return out;
  };
  let fetched: FetchMessageObject[];
  try {
    fetched = await one(uids);
  } catch (err) {
    // A dropped connection is a real failure: the next check tries again.
    if (!client.usable) throw err;
    if (uids.length === 1) return [];
    fetched = [];
    for (const uid of uids) fetched.push(...(await one([uid]).catch(() => [])));
  }
  return fetched.sort((a, b) => a.uid - b.uid);
}

export function createImapMailSource(getConfig: () => ImapConfig): MailSource {
  async function session<T>(signal: AbortSignal | undefined, work: (client: ImapFlow, config: ImapConfig) => Promise<T>): Promise<T> {
    const config = getConfig();
    checkConfig(config);
    if (signal?.aborted) throw new DOMException('The email check was cancelled.', 'AbortError');
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure ?? true,
      // Google shows an app password in groups of four; the spaces aren't part of it.
      auth: { user: config.address.trim(), pass: (config.password ?? '').replace(/\s+/g, '') },
      logger: false,
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 60_000,
    });
    // A dropped connection also rejects the command that was running; this
    // only stops the event from crashing the app.
    client.on('error', () => undefined);
    const stop = () => client.close();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      await client.connect();
      await client.mailboxOpen(config.mailbox, { readOnly: true });
      return await work(client, config);
    } catch (err) {
      if (signal?.aborted) throw new DOMException('The email check was cancelled.', 'AbortError');
      throw explainImapError(err, config);
    } finally {
      signal?.removeEventListener('abort', stop);
      await client.logout().catch(() => client.close());
    }
  }

  return {
    fetchSince(cursor: MailCursor | null, o: FetchOptions) {
      return session(o.signal, async (client) => {
        const box = client.mailbox;
        if (!box) throw new Error('The mailbox did not open.');
        const uidValidity = String(box.uidValidity);
        const sameBox = cursor !== null && cursor.uidValidity === uidValidity;
        const found = sameBox
          ? await client.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true })
          : await client.search({ since: new Date(o.now.getTime() - o.sinceDays * DAY_MS) }, { uid: true });
        // imapflow answers a refused search with false, not an error. Treating
        // that as "no mail" would move the cursor past mail never read.
        if (!Array.isArray(found)) throw new Error('Gmail did not answer the search. The next check will try again.');
        // "n:*" always includes the newest message, even when it's older than n.
        const uids = found.filter((uid) => !sameBox || uid > cursor.lastUid).sort((a, b) => a - b);
        const batch = uids.slice(0, o.maxMessages);
        const more = uids.length > batch.length;
        const end: MailCursor = { uidValidity, lastUid: Math.max(sameBox ? cursor.lastUid : 0, box.uidNext - 1) };
        if (batch.length === 0) return { messages: [], cursor: end, more: false };

        // Read every header first: imapflow can't run a download inside a fetch.
        const fetched = await fetchHeaders(client, batch);
        const messages: MailMessage[] = [];
        for (const m of fetched) {
          // An email whose text won't download still counts, by its sender and subject.
          const text = await readText(client, m.uid, m.bodyStructure).catch(() => '');
          messages.push(toMessage(m, text, uidValidity, o.now));
        }
        // The batch's last uid, even when Gmail wouldn't give us that email:
        // otherwise one broken email would stop every check after it.
        const last: MailCursor = { uidValidity, lastUid: batch.at(-1)! };
        return { messages, cursor: more ? last : { uidValidity, lastUid: Math.max(last.lastUid, end.lastUid) }, more };
      });
    },

    async test() {
      await session(undefined, async () => undefined);
    },
  };
}
