// The IMAP adapter against hoodiecrow, a strict IMAP server for tests, on a
// free port with no TLS. Gmail itself is checked on Windows (the handover).

import type { AddressInfo } from 'node:net';
import hoodiecrow from 'hoodiecrow-imap';
import { ImapFlow } from 'imapflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freePort } from '../../../../tests/helpers/test-app.ts';
import { createImapMailSource, explainImapError, type ImapConfig } from './imap.ts';

const NOW = new Date('2026-10-29T00:00:00Z');
const CRLF = '\r\n';
const mail = (lines: string[]) => lines.join(CRLF);

const OLD = mail([
  'From: Old News <news@example.com>',
  'To: me@gmail.com',
  'Subject: Old',
  'Message-ID: <old@example.com>',
  'Date: Tue, 29 Sep 2026 09:00:00 +1000',
  '',
  'An old email.',
]);
const ALTERNATIVE = mail([
  'From: Talent Team <Careers@Atlassian.com>',
  'To: me@gmail.com',
  'Subject: Your application for Senior Engineer',
  'Message-ID: <abc1@atlassian.com>',
  'Date: Mon, 26 Oct 2026 09:00:00 +1100',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Thanks for applying. Unfortunately we will not progress.',
  '--b1',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Thanks for applying (HTML).</p>',
  '--b1--',
  '',
]);
const HTML_ONLY = mail([
  'From: noreply@myworkday.com',
  'To: me@gmail.com',
  'Subject: =?UTF-8?Q?Interview_=E2=80=93_Canva?=',
  'Date: Tue, 27 Oct 2026 09:00:00 +1100',
  'Content-Type: text/html; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  '<html><head><style>p{color:red}</style></head><body><p>We&#39;d like to invite you =E2=80=93 interview</p></body></html>',
  '',
]);
const WITH_PDF = mail([
  'From: Sam Lee <sam@hays.com.au>',
  'To: me@gmail.com',
  'Subject: Contract attached',
  'Message-ID: <pdf1@hays.com.au>',
  'Date: Wed, 28 Oct 2026 09:00:00 +1100',
  'Content-Type: multipart/mixed; boundary="m1"',
  '',
  '--m1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Please find the contract attached.',
  '--m1',
  'Content-Type: application/pdf; name="contract.pdf"',
  'Content-Disposition: attachment; filename="contract.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 SECRET-PDF-BYTES').toString('base64'),
  '--m1--',
  '',
]);

let server: ReturnType<typeof hoodiecrow>;
let port: number;

beforeEach(async () => {
  server = hoodiecrow({
    plugins: ['ENABLE', 'UIDPLUS'],
    storage: {
      INBOX: {
        uidvalidity: 7,
        messages: [
          { raw: OLD, internaldate: '29-Sep-2026 09:00:00 +1000' },
          { raw: ALTERNATIVE, internaldate: '26-Oct-2026 09:00:00 +1100' },
          { raw: HTML_ONLY, internaldate: '27-Oct-2026 09:00:00 +1100' },
          { raw: WITH_PDF, internaldate: '28-Oct-2026 09:00:00 +1100' },
        ],
      },
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = ((server.server ?? server).address() as AddressInfo).port;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function source(extra: Partial<ImapConfig> = {}) {
  return createImapMailSource(() => ({
    host: '127.0.0.1',
    port,
    address: 'testuser',
    password: 'test pass'.replace(' ', ''),
    mailbox: 'INBOX',
    secure: false,
    ...extra,
  }));
}

const opts = { maxMessages: 100, sinceDays: 14, now: NOW };

async function otherClient(): Promise<ImapFlow> {
  const client = new ImapFlow({ host: '127.0.0.1', port, secure: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false });
  await client.connect();
  return client;
}

describe('ImapMailSource', () => {
  it('reads plain text, or HTML as text, oldest first', async () => {
    const { messages, cursor, more } = await source().fetchSince(null, opts);
    expect(messages.map((m) => m.subject)).toEqual(['Your application for Senior Engineer', 'Interview – Canva', 'Contract attached']);
    const [first, second, third] = messages;
    expect(first).toMatchObject({
      id: '<abc1@atlassian.com>',
      from: 'careers@atlassian.com',
      fromName: 'Talent Team',
      to: 'me@gmail.com',
      receivedAt: '2026-10-25T22:00:00.000Z',
      after: { uidValidity: '7', lastUid: 2 },
    });
    expect(first!.text).toBe('Thanks for applying. Unfortunately we will not progress.');
    expect(second!.id).toBe('uid:7:3');
    expect(second!.fromName).toBeNull();
    expect(second!.text).toBe("We'd like to invite you – interview");
    expect(third!.text).toBe('Please find the contract attached.');
    expect(third!.text).not.toContain('SECRET-PDF-BYTES');
    expect(cursor).toEqual({ uidValidity: '7', lastUid: 4 });
    expect(more).toBe(false);
  });

  it('first check reads only recent mail', async () => {
    const { messages } = await source().fetchSince(null, { ...opts, sinceDays: 60 });
    expect(messages.map((m) => m.subject)).toContain('Old');
    const recent = await source().fetchSince(null, opts);
    expect(recent.messages.map((m) => m.subject)).not.toContain('Old');
  });

  it('carries on from the cursor, and then reads only new mail', async () => {
    const first = await source().fetchSince(null, opts);
    const none = await source().fetchSince(first.cursor, opts);
    expect(none.messages).toEqual([]);
    expect(none.more).toBe(false);
    expect(none.cursor).toEqual(first.cursor);

    const client = await otherClient();
    await client.append('INBOX', mail(['From: a@b.com', 'Subject: New one', 'Message-ID: <new@b.com>', '', 'Hi']), [], new Date('2026-10-28T23:00:00Z'));
    await client.logout();
    const next = await source().fetchSince(none.cursor, opts);
    expect(next.messages.map((m) => m.subject)).toEqual(['New one']);
    expect(next.cursor).toEqual({ uidValidity: '7', lastUid: 5 });
  });

  it('takes the oldest first, in rounds', async () => {
    const round1 = await source().fetchSince(null, { ...opts, maxMessages: 2 });
    expect(round1.messages.map((m) => m.subject)).toEqual(['Your application for Senior Engineer', 'Interview – Canva']);
    expect(round1.more).toBe(true);
    expect(round1.cursor).toEqual({ uidValidity: '7', lastUid: 3 });
    const round2 = await source().fetchSince(round1.cursor, { ...opts, maxMessages: 2 });
    expect(round2.messages.map((m) => m.subject)).toEqual(['Contract attached']);
    expect(round2.more).toBe(false);
  });

  it('another UIDVALIDITY reads by date again', async () => {
    const { messages } = await source().fetchSince({ uidValidity: '999', lastUid: 50 }, opts);
    expect(messages).toHaveLength(3);
  });

  it('never marks mail as read', async () => {
    await source().fetchSince(null, opts);
    const client = await otherClient();
    await client.mailboxOpen('INBOX', { readOnly: true });
    const flags: string[][] = [];
    for await (const m of client.fetch('1:*', { flags: true })) flags.push([...(m.flags ?? [])]);
    await client.logout();
    expect(flags).toHaveLength(4);
    expect(flags.flat()).not.toContain('\\Seen');
  });

  it('a wrong password says so in plain words', async () => {
    await expect(source({ password: 'wrong' }).fetchSince(null, opts)).rejects.toThrow(
      'Gmail refused the address or app password. Check both in Settings → Email. An app password is 16 letters, made at myaccount.google.com/apppasswords.',
    );
  });

  it('no server says so in plain words', async () => {
    const closed = await freePort();
    await expect(source({ port: closed }).fetchSince(null, opts)).rejects.toThrow("Can't reach 127.0.0.1. Check your internet connection.");
  });

  it('a mailbox that does not exist says so', async () => {
    await expect(source({ mailbox: 'Jobs' }).fetchSince(null, opts)).rejects.toThrow('Gmail has no mailbox called Jobs.');
  });

  it('test() logs in and opens the mailbox, and says what went wrong', async () => {
    await expect(source().test()).resolves.toBeUndefined();
    await expect(source({ password: 'wrong' }).test()).rejects.toThrow(/Gmail refused/);
    await expect(source({ password: null }).test()).rejects.toThrow('Add your Gmail app password first: Settings → Email.');
  });
});

describe('ImapMailSource: when Gmail misbehaves', () => {
  it('a refused search fails the round instead of skipping mail', async () => {
    vi.spyOn(ImapFlow.prototype, 'search').mockResolvedValue(false);
    await expect(source().fetchSince({ uidValidity: '7', lastUid: 1 }, opts)).rejects.toThrow(
      'Gmail did not answer the search. The next check will try again.',
    );
  });

  it('an email whose text cannot be downloaded still comes through, with no text', async () => {
    const real = ImapFlow.prototype.download;
    vi.spyOn(ImapFlow.prototype, 'download').mockImplementation(function (this: ImapFlow, range, part, o) {
      if (String(range) === '3') return Promise.reject(new Error('Some messages could not be FETCHed (Failure)'));
      return real.call(this, range, part, o);
    });
    const { messages } = await source().fetchSince(null, opts);
    expect(messages.map((m) => [m.subject, m.text === ''])).toEqual([
      ['Your application for Senior Engineer', false],
      ['Interview – Canva', true],
      ['Contract attached', false],
    ]);
  });

  it('an email Gmail will not fetch is skipped, and the rest still come through', async () => {
    const real = ImapFlow.prototype.fetch;
    vi.spyOn(ImapFlow.prototype, 'fetch').mockImplementation(function (this: ImapFlow, range, query, o) {
      const uids = Array.isArray(range) ? range.map(Number) : String(range).split(',').map(Number);
      if (uids.includes(3)) {
        return (async function* () {
          throw new Error('Some messages could not be FETCHed (Failure)');
        })();
      }
      return real.call(this, range, query, o);
    });
    const { messages, cursor } = await source().fetchSince(null, opts);
    expect(messages.map((m) => m.subject)).toEqual(['Your application for Senior Engineer', 'Contract attached']);
    expect(cursor).toEqual({ uidValidity: '7', lastUid: 4 });
  });

  it('an email with a broken date gets the time it was read', async () => {
    const real = ImapFlow.prototype.fetch;
    vi.spyOn(ImapFlow.prototype, 'fetch').mockImplementation(function (this: ImapFlow, range, query, o) {
      const inner = real.call(this, range, query, o);
      return (async function* () {
        for await (const m of inner) yield m.uid === 2 ? { ...m, internalDate: new Date(Number.NaN) } : m;
      })();
    });
    const { messages } = await source().fetchSince(null, opts);
    expect(messages[0]!.receivedAt).toBe(NOW.toISOString());
  });
});

describe('explainImapError', () => {
  const config = { host: 'imap.gmail.com', port: 993, address: 'me@gmail.com', password: 'x', mailbox: 'INBOX' };
  const err = (fields: Record<string, unknown>) => Object.assign(new Error(String(fields.message ?? 'Command failed')), fields);

  it.each<Record<string, unknown>>([
    { authenticationFailed: true, serverResponseCode: 'AUTHENTICATIONFAILED', responseText: 'Invalid credentials (Failure)' },
    { authenticationFailed: true, serverResponseCode: 'ALERT', responseText: 'Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)' },
    { authenticationFailed: true, responseText: 'Invalid credentials (Failure)' },
  ])('a bad password says so: %o', (fields) => {
    expect(explainImapError(err(fields), config).message).toMatch(/^Gmail refused the address or app password\./);
  });

  it('any other refused login gives Gmail\'s own words', () => {
    const e = err({ authenticationFailed: true, serverResponseCode: 'ALERT', responseText: 'Too many simultaneous connections. (Failure)' });
    expect(explainImapError(e, config).message).toBe('Gmail refused the login: Too many simultaneous connections. (Failure)');
    const web = err({ authenticationFailed: true, serverResponseCode: 'WEBALERT', responseText: 'Please log in via your web browser (Failure)' });
    expect(explainImapError(web, config).message).toBe('Gmail refused the login: Please log in via your web browser (Failure)');
  });

  it.each(['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'])(
    'a swapped certificate (%s) points at antivirus email scanning',
    (code) => {
      expect(explainImapError(err({ code }), config).message).toBe(
        "Can't check imap.gmail.com's certificate. Antivirus software that scans email often swaps it. Turn off its email or encrypted-connection scanning for Job Registry, then try again.",
      );
    },
  );
});
