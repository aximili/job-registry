// The port for reading email (architecture §6.3). ImapMailSource reads Gmail
// over IMAP; FakeMailSource stands in for it in tests. The email module only
// ever sees this interface.

// Where the last check stopped, so the next one starts at newer mail.
export type MailCursor = { uidValidity: string; lastUid: number };

export type MailMessage = {
  // The Message-ID header, or "uid:<uidValidity>:<uid>" when there isn't one.
  id: string;
  // The address only, in lower case.
  from: string;
  fromName: string | null;
  to: string;
  subject: string;
  // When the mailbox received it, ISO 8601 in UTC.
  receivedAt: string;
  // Plain text (HTML turned into text), at most 64 KB.
  text: string;
  // The cursor just after this message.
  after: MailCursor;
};

export type FetchOptions = { maxMessages: number; sinceDays: number; now: Date; signal?: AbortSignal };

export interface MailSource {
  // Oldest first. With no cursor, or one from another UIDVALIDITY, it reads by date.
  fetchSince(cursor: MailCursor | null, o: FetchOptions): Promise<{ messages: MailMessage[]; cursor: MailCursor; more: boolean }>;
  // Logs in and opens the mailbox. Throws an Error whose message is a sentence to show.
  test(): Promise<void>;
}
