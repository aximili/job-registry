// The email module's logic (architecture §7.5). It reads new mail through the
// MailSource port, keeps what the first filter passes, asks the AI what each
// email means, and stores a suggestion. Only confirm() ever changes a job:
// a status change (source "email") and a note with the summary. Whole emails
// are never stored or logged; the text lives in memory for one AI call.

import type {
  ConfirmSuggestionRequest,
  EmailClassification,
  EmailSettings,
  EmailStatus,
  EmailSuggestion,
  EmailTestResult,
  JobSummary,
  Status,
} from '../../../shared/contracts/index.ts';
import { formatDate } from '../../../shared/dates.ts';
import { suggestStatus } from '../../../shared/email-status.ts';
import { EMAIL_EVENT_LABEL } from '../../../shared/labels.ts';
import type { Clock } from '../../core/config.ts';
import { AiAnswerError, AiRefusedError, AiUnavailableError, ConflictError, NotFoundError, ValidationError } from '../../core/errors.ts';
import type { EventBus } from '../../core/events.ts';
import type { Logger } from '../../core/logger.ts';
import type { AiService } from '../ai/index.ts';
import type { ContactsService } from '../contacts/index.ts';
import type { JobsService } from '../jobs/index.ts';
import type { NotesService } from '../notes/index.ts';
import { firstFilter, type FilterJob } from './filter.ts';
import type { MailCursor, MailMessage, MailSource } from './mail-source.ts';
import type { EmailRepo, SuggestionRow } from './repo.ts';
import { emailText } from './text.ts';

export interface EmailService {
  // Reads new mail now. A check already running is joined, not repeated.
  checkNow(): Promise<EmailStatus>;
  status(): EmailStatus;
  // Logs in and opens the mailbox. Never throws: the answer is a sentence.
  test(): Promise<EmailTestResult>;
  // Waiting for you, newest email first.
  listSuggestions(): EmailSuggestion[];
  confirm(id: number, req: ConfirmSuggestionRequest): EmailSuggestion;
  dismiss(id: number): EmailSuggestion;
  // The timer: a first check a minute after start, then every pollMinutes.
  start(): void;
  // Stops the timer and cancels a check that's running.
  stop(): void;
  onIdle(): Promise<void>;
}

export type EmailOptions = {
  repo: EmailRepo;
  bus: EventBus;
  mail: MailSource;
  ai: AiService;
  jobs: JobsService;
  contacts: ContactsService;
  notes: NotesService;
  statuses: () => Status[];
  getConfig: () => EmailSettings;
  password: () => string | null;
  now: Clock;
  logger: Logger;
};

const NOT_SET_UP = 'Connect Gmail first: Settings → Email.';
const ALREADY = 'This email was already handled.';
const UNREADABLE = "The AI couldn't read this email. Open Gmail to read it.";
const FIRST_CHECK_MS = 60_000;
const MAX_ROUNDS = 10;
const SURE = 0.6;
const SUBJECT_LIMIT = 300;

const isAbort = (err: unknown): boolean => (err as Error)?.name === 'AbortError';

// skipped: seen before, or kept out by the first filter, so the AI wasn't asked.
// ignored: the AI read it and it isn't about a job. refused: the AI server refused it.
type Outcome = 'added' | 'ignored' | 'skipped' | { stop: string } | { refused: string; jobId: number | null };

// An email the AI server refuses on this many checks still gets a card, so
// one email it can't take never holds up the rest of the inbox.
const REFUSALS_BEFORE_CARD = 3;

export function createEmailService(opts: EmailOptions): EmailService {
  const { repo, bus, logger } = opts;
  // Resolves false when the check was cancelled.
  let running: Promise<boolean> | null = null;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let wasReady = false;

  const hasPassword = (): boolean => {
    try {
      return !!opts.password()?.trim();
    } catch {
      return false;
    }
  };
  const isConfigured = (): boolean => !!opts.getConfig().address.trim() && hasPassword();
  const isReady = (): boolean => opts.getConfig().enabled && isConfigured();

  // The cursor belongs to one address and one mailbox. Another account's
  // UIDs mean nothing here, so a change starts again by date.
  type SavedCursor = MailCursor & { address: string; mailbox: string };
  const owner = () => {
    const config = opts.getConfig();
    return { address: config.address.trim().toLowerCase(), mailbox: config.mailbox };
  };

  function readCursor(): MailCursor | null {
    const raw = repo.getValue('cursor');
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<SavedCursor>;
      const { address, mailbox } = owner();
      if (value.address !== address || value.mailbox !== mailbox) return null;
      if (typeof value.uidValidity !== 'string' || !Number.isInteger(value.lastUid)) return null;
      return { uidValidity: value.uidValidity, lastUid: value.lastUid! };
    } catch {
      return null;
    }
  }
  const saveCursor = (cursor: MailCursor) =>
    repo.setValue('cursor', JSON.stringify({ ...owner(), uidValidity: cursor.uidValidity, lastUid: cursor.lastUid } satisfies SavedCursor));

  function status(): EmailStatus {
    const lastAdded = repo.getValue('lastAdded');
    return {
      enabled: opts.getConfig().enabled,
      configured: isConfigured(),
      checking: running !== null,
      lastCheckAt: repo.getValue('lastCheckAt'),
      lastError: repo.getValue('lastError') || null,
      lastAdded: lastAdded === null ? null : Number(lastAdded),
      pending: repo.countByState('pending'),
    };
  }

  // Your open and closed jobs (not archived), with their contacts' addresses.
  function filterJobs(): { list: FilterJob[]; byId: Map<number, JobSummary> } {
    const summaries = opts.jobs.list({ status: 'all', archived: false, sort: 'updated' });
    const list = summaries.map((j) => ({
      id: j.id,
      company: j.company,
      agency: j.agency,
      updatedAt: j.updatedAt,
      contactEmails: opts.contacts
        .listForJob(j.id)
        .map((c) => c.email)
        .filter((e): e is string => !!e),
    }));
    return { list, byId: new Map(summaries.map((j) => [j.id, j])) };
  }

  async function handle(
    msg: MailMessage,
    jobs: { list: FilterJob[]; byId: Map<number, JobSummary> },
    signal: AbortSignal,
  ): Promise<Outcome> {
    if (repo.has(msg.id)) return 'skipped';
    const config = opts.getConfig();
    const result = firstFilter({ from: msg.from, subject: msg.subject, text: msg.text }, jobs.list, { ownAddress: config.address });
    if (!result.pass) return 'skipped';

    const statuses = opts.statuses();
    const label = (id: string) => statuses.find((s) => s.id === id)?.label ?? id;
    const candidates = result.jobIds.flatMap((id) => {
      const j = jobs.byId.get(id);
      return j ? [{ id, title: j.title, company: j.company, agency: j.agency, status: label(j.status) }] : [];
    });

    let answer: EmailClassification;
    try {
      answer = await opts.ai.classifyEmail(
        {
          from: msg.fromName ? `${msg.fromName} <${msg.from}>` : msg.from,
          subject: msg.subject,
          receivedAt: msg.receivedAt,
          text: emailText(msg.text),
          candidates,
        },
        { signal, priority: 'background' },
      );
    } catch (err) {
      if (isAbort(err)) throw err;
      // The AI answered, but never in the right shape: show the email anyway, so it isn't lost.
      if (err instanceof AiAnswerError) {
        insertUnreadable(msg, result.jobIds[0] ?? null);
        return 'added';
      }
      // Refused (an HTTP error or a timeout): the server may refuse every email
      // (a wrong model, say), so the check decides what to do with it.
      if (err instanceof AiRefusedError) return { refused: err.message, jobId: result.jobIds[0] ?? null };
      if (err instanceof AiUnavailableError) return { stop: `Waiting for the AI: ${err.message}` };
      throw err;
    }

    const createdAt = opts.now().toISOString();
    if (answer.event === 'other' && (answer.jobId === null || answer.confidence < SURE)) {
      // Not about a job: keep only that it was read, so it isn't read again.
      repo.insert({
        messageId: msg.id,
        jobId: null,
        fromAddr: null,
        subject: null,
        receivedAt: msg.receivedAt,
        event: null,
        suggestedStatus: null,
        confidence: null,
        summary: null,
        company: null,
        role: null,
        state: 'ignored',
        createdAt,
      });
      return 'ignored';
    }
    const job = answer.jobId !== null ? jobs.byId.get(answer.jobId) : undefined;
    repo.insert({
      messageId: msg.id,
      jobId: job?.id ?? null,
      fromAddr: msg.from,
      subject: msg.subject.slice(0, SUBJECT_LIMIT),
      receivedAt: msg.receivedAt,
      event: answer.event,
      suggestedStatus: job ? suggestStatus(answer.event, job.status, statuses) : null,
      confidence: answer.confidence,
      summary: answer.summary,
      company: answer.company,
      role: answer.role,
      state: 'pending',
      createdAt,
    });
    return 'added';
  }

  // A card for an email the AI couldn't read: its sender and subject, to open in Gmail.
  function insertUnreadable(msg: MailMessage, jobId: number | null): void {
    repo.insert({
      messageId: msg.id,
      jobId,
      fromAddr: msg.from,
      subject: msg.subject.slice(0, SUBJECT_LIMIT),
      receivedAt: msg.receivedAt,
      event: 'other',
      suggestedStatus: null,
      confidence: 0,
      summary: UNREADABLE,
      company: null,
      role: null,
      state: 'pending',
      createdAt: opts.now().toISOString(),
    });
  }

  // How many checks in a row the AI server has refused this email.
  function countRefusal(id: string): number {
    const key = `refused:${id}`;
    const count = Number(repo.getValue(key) ?? '0') + 1;
    repo.setValue(key, String(count));
    return count;
  }

  async function runCheck(): Promise<boolean> {
    const own = new AbortController();
    controller = own;
    const config = opts.getConfig();
    const startedAt = opts.now().getTime();
    let cursor = readCursor();
    let read = 0;
    let added = 0;
    let error: string | null = null;
    try {
      let jobs: ReturnType<typeof filterJobs> | null = null;
      rounds: for (let round = 0; round < MAX_ROUNDS; round++) {
        const batch = await opts.mail.fetchSince(cursor, {
          maxMessages: config.maxPerCheck,
          sinceDays: config.firstCheckDays,
          now: opts.now(),
          signal: own.signal,
        });
        jobs ??= filterJobs();
        // Emails the AI server refused in this check. If it then reads a later
        // one, they were refused for themselves and get a card. If it reads
        // none, it refuses everything: the check stops before the first of them.
        let held: { msg: MailMessage; jobId: number | null; reason: string }[] = [];
        const passed = (msg: MailMessage) => {
          read++;
          if (held.length > 0) return;
          cursor = msg.after;
          saveCursor(cursor);
        };
        for (const msg of batch.messages) {
          const outcome = await handle(msg, jobs, own.signal);
          if (typeof outcome === 'object' && 'stop' in outcome) {
            // The cursor stays before this email (or the first held one), so the next check reads it.
            error = outcome.stop;
            break rounds;
          }
          if (typeof outcome === 'object') {
            if (countRefusal(msg.id) < REFUSALS_BEFORE_CARD) {
              held.push({ msg, jobId: outcome.jobId, reason: outcome.refused });
              continue;
            }
            insertUnreadable(msg, outcome.jobId);
            repo.deleteValue(`refused:${msg.id}`);
            added++;
            passed(msg);
            continue;
          }
          if (outcome === 'added' || outcome === 'ignored') {
            repo.deleteValue(`refused:${msg.id}`);
            for (const h of held) {
              insertUnreadable(h.msg, h.jobId);
              repo.deleteValue(`refused:${h.msg.id}`);
              added++;
              read++;
            }
            held = [];
          }
          if (outcome === 'added') added++;
          passed(msg);
        }
        if (held.length > 0) {
          error = `Waiting for the AI: ${held[0]!.reason}`;
          break;
        }
        cursor = batch.cursor;
        saveCursor(cursor);
        if (!batch.more) break;
      }
    } catch (err) {
      // Cancelled because the app is stopping: nothing more to record.
      if (isAbort(err) || own.signal.aborted) return false;
      error = (err as Error).message;
    } finally {
      if (controller === own) controller = null;
    }

    // The message only, never the email: logs must not hold email text.
    if (error) logger.warn({ reason: error }, 'The email check stopped');
    else logger.info({ read, added, ms: opts.now().getTime() - startedAt }, 'Checked email');
    repo.setValue('lastCheckAt', opts.now().toISOString());
    repo.setValue('lastError', error ?? '');
    repo.setValue('lastAdded', String(added));
    if (added > 0) bus.emit('email.suggestionsAdded', { count: added });
    bus.emit('email.checked', { ok: error === null, error });
    return true;
  }

  // What the email points to now. A card can wait for days, and you may
  // move the job by hand meanwhile: the card must never move it backwards.
  function currentSuggestion(row: SuggestionRow, job: { status: string } | null): string | null {
    if (row.state !== 'pending') return row.suggestedStatus;
    return job ? suggestStatus(row.event ?? 'other', job.status, opts.statuses()) : null;
  }

  function toDto(row: SuggestionRow, job: JobSummary | null): EmailSuggestion {
    return {
      id: row.id,
      jobId: row.jobId,
      job,
      fromAddr: row.fromAddr ?? '',
      subject: row.subject ?? '',
      receivedAt: row.receivedAt,
      event: row.event ?? 'other',
      suggestedStatus: currentSuggestion(row, job),
      confidence: row.confidence ?? 0,
      summary: row.summary ?? '',
      company: row.company,
      role: row.role,
      state: row.state,
      appliedStatus: row.appliedStatus,
      createdAt: row.createdAt,
      handledAt: row.handledAt,
    };
  }

  function dtoFor(row: SuggestionRow): EmailSuggestion {
    const job = row.jobId !== null ? (opts.jobs.getSummaries([row.jobId])[0] ?? null) : null;
    return toDto(row, job);
  }

  function pendingOrThrow(id: number): SuggestionRow {
    const row = repo.get(id);
    if (!row || row.state === 'ignored') throw new NotFoundError(`Suggestion ${id} not found.`);
    if (row.state !== 'pending') throw new ConflictError(ALREADY);
    return row;
  }

  // "Email, 3 Nov 2026 (rejection) from careers@atlassian.com: <summary>". An
  // email the AI couldn't read is noted by its subject instead.
  function noteText(row: SuggestionRow): string {
    const event = row.event ?? 'other';
    const what = event === 'other' ? '' : ` (${EMAIL_EVENT_LABEL[event].toLowerCase()})`;
    const summary = row.summary === UNREADABLE ? row.subject?.trim() : row.summary?.trim() || row.subject?.trim();
    return `Email, ${formatDate(row.receivedAt)}${what} from ${row.fromAddr ?? 'unknown sender'}: ${summary || '(no subject)'}`;
  }

  function schedule(ms: number): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!started) return;
    timer = setTimeout(tick, ms);
    timer.unref?.();
  }

  function tick(): void {
    if (isReady()) {
      checkNow().catch((err: unknown) => {
        if (!isAbort(err)) logger.warn({ reason: (err as Error).message }, 'The email check could not start');
      });
    }
    schedule(opts.getConfig().pollMinutes * 60_000);
  }

  async function checkNow(): Promise<EmailStatus> {
    if (!isReady()) throw new ValidationError(NOT_SET_UP);
    running ??= runCheck().finally(() => {
      running = null;
    });
    if (!(await running)) throw new DOMException('The email check was cancelled.', 'AbortError');
    return status();
  }

  bus.on('settings.changed', ({ keys }) => {
    if (!keys.includes('email') && !keys.includes('secrets')) return;
    const ready = isReady();
    // Just turned on (or just set up): check straight away. Otherwise keep the new interval.
    if (ready && !wasReady) schedule(0);
    else schedule(opts.getConfig().pollMinutes * 60_000);
    wasReady = ready;
  });

  return {
    checkNow,
    status,

    async test() {
      const config = opts.getConfig();
      if (!config.address.trim()) return { ok: false, detail: 'Add your Gmail address first: Settings → Email.' };
      if (!hasPassword()) return { ok: false, detail: 'Add your Gmail app password first: Settings → Email.' };
      try {
        await opts.mail.test();
        return { ok: true, detail: `Connected to ${config.host} as ${config.address}.` };
      } catch (err) {
        return { ok: false, detail: (err as Error).message };
      }
    },

    listSuggestions() {
      const rows = repo.listByState('pending');
      const ids = [...new Set(rows.flatMap((r) => (r.jobId !== null ? [r.jobId] : [])))];
      const jobs = new Map(opts.jobs.getSummaries(ids).map((j) => [j.id, j]));
      return rows.map((r) => toDto(r, r.jobId !== null ? (jobs.get(r.jobId) ?? null) : null));
    },

    confirm(id, req) {
      const row = pendingOrThrow(id);
      const jobId = req.jobId ?? row.jobId;
      if (jobId === null) throw new ValidationError('Pick the job this email is about.');
      const job = opts.jobs.get(jobId);
      // Your choice on the card, or what the email points to for this job now.
      const status = req.status !== undefined ? req.status : currentSuggestion(row, job);
      const changes = status !== null && status !== job.status;
      if (changes) opts.jobs.changeStatus(jobId, status!, 'email');
      opts.notes.add(jobId, noteText(row));
      if (!repo.handle(id, 'confirmed', { jobId, appliedStatus: changes ? status : null, at: opts.now().toISOString() })) {
        throw new ConflictError(ALREADY);
      }
      bus.emit('email.suggestionHandled', { suggestionId: id, state: 'confirmed' });
      return dtoFor(repo.get(id)!);
    },

    dismiss(id) {
      const row = pendingOrThrow(id);
      repo.handle(id, 'dismissed', { jobId: row.jobId, appliedStatus: null, at: opts.now().toISOString() });
      bus.emit('email.suggestionHandled', { suggestionId: id, state: 'dismissed' });
      return dtoFor(repo.get(id)!);
    },

    start() {
      started = true;
      wasReady = isReady();
      schedule(FIRST_CHECK_MS);
    },

    stop() {
      started = false;
      schedule(0);
      controller?.abort();
    },

    onIdle: () => (running ?? Promise.resolve()).then(() => undefined),
  };
}
