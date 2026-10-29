// A MailSource for tests: a list of emails in memory, with the same cursor
// rules as the IMAP adapter. It can fail, be slow, and honours cancelling.

import type { FetchOptions, MailCursor, MailMessage, MailSource } from '../../server/modules/email/mail-source.ts';

export type FakeMail = Partial<Omit<MailMessage, 'after'>> & { uid: number };

const DAY_MS = 24 * 60 * 60 * 1000;

export class FakeMailSource implements MailSource {
  messages: FakeMail[] = [];
  uidValidity = '1';
  fail: Error | null = null;
  fetches = 0;
  // The cursor each fetch was given.
  cursors: (MailCursor | null)[] = [];
  tests = 0;
  delayMs = 0;

  // Adds an email with the next uid, received now unless it says otherwise.
  add(mail: Partial<Omit<MailMessage, 'after'>> = {}): FakeMail {
    const uid = Math.max(0, ...this.messages.map((m) => m.uid)) + 1;
    const full: FakeMail = { uid, ...mail };
    this.messages.push(full);
    return full;
  }

  private full(m: FakeMail): MailMessage {
    return {
      id: m.id ?? `<${m.uid}@fake.example>`,
      from: m.from ?? 'someone@example.com',
      fromName: m.fromName ?? null,
      to: m.to ?? 'me@gmail.com',
      subject: m.subject ?? '',
      receivedAt: m.receivedAt ?? '2026-10-28T00:00:00.000Z',
      text: m.text ?? '',
      after: { uidValidity: this.uidValidity, lastUid: m.uid },
    };
  }

  async fetchSince(cursor: MailCursor | null, o: FetchOptions) {
    this.fetches++;
    this.cursors.push(cursor);
    await wait(this.delayMs, o.signal);
    if (this.fail) throw this.fail;
    const same = cursor !== null && cursor.uidValidity === this.uidValidity;
    const since = o.now.getTime() - o.sinceDays * DAY_MS;
    const all = [...this.messages].sort((a, b) => a.uid - b.uid);
    const list = all.filter((m) => (same ? m.uid > cursor.lastUid : new Date(this.full(m).receivedAt).getTime() >= since));
    const batch = list.slice(0, o.maxMessages).map((m) => this.full(m));
    const more = list.length > batch.length;
    const newest = Math.max(same ? cursor.lastUid : 0, ...all.map((m) => m.uid));
    const end: MailCursor = more ? batch.at(-1)!.after : { uidValidity: this.uidValidity, lastUid: newest };
    return { messages: batch, cursor: end, more };
  }

  async test() {
    this.tests++;
    if (this.fail) throw this.fail;
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  const abort = () => new DOMException('The email check was cancelled.', 'AbortError');
  if (signal?.aborted) return Promise.reject(abort());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abort());
    }, { once: true });
  });
}
