// Resumes and cover letters for each job. Every save adds a version, and
// nothing is overwritten. Marking a version as sent freezes it with the
// template CSS as it was then, so later template changes never alter what
// you sent. See docs/architecture.md §7.4.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type {
  Attachment,
  AttachmentKind,
  Document,
  Job,
  DocumentKind,
  DocumentListItem,
  DocumentSummary,
  ExporterInfo,
  SentDocuments,
} from '../../../shared/contracts/index.ts';
import { documentPage } from '../../../shared/document-page.ts';
import type { Clock } from '../../core/config.ts';
import { NotFoundError, ValidationError } from '../../core/errors.ts';
import type { EventBus } from '../../core/events.ts';
import type { AiService } from '../ai/index.ts';
import type { JobsService } from '../jobs/index.ts';
import type { ProfileFileName, ProfileService } from '../profile/index.ts';
import type { DocumentExporter, ExportedFile } from './exporter.ts';
import { attachmentType, cleanFileName, MAX_ATTACHMENT_BYTES, TOO_BIG, WRONG_TYPE } from './files.ts';
import type { DocumentsRepo } from './repo.ts';

export interface DocumentsService {
  list(jobId: number): DocumentSummary[];
  listAll(kind?: DocumentKind): DocumentListItem[];
  get(id: number): Document;
  saveVersion(jobId: number, req: { kind: DocumentKind; markdown: string; origin: 'generated' | 'edited' }): Document;
  copyFrom(jobId: number, sourceId: number): Document;
  markSent(id: number): Document;
  latestSent(jobId: number): SentDocuments;
  // The A4 print page: a sent version uses the CSS it was sent with.
  render(id: number): { title: string; html: string };
  exporters(): ExporterInfo[];
  export(id: number, format: string): Promise<ExportedFile>;
  // Writes a draft with the AI, as it comes. Nothing is saved: the editor
  // saves a version when you choose. Checks the job and your master profile
  // before it starts.
  generate(jobId: number, kind: DocumentKind, opts: { signal: AbortSignal }): AsyncIterable<string>;
  // Keeps a file you made elsewhere with the job, in data/files/<jobId>/.
  attach(jobId: number, file: { kind: AttachmentKind; fileName: string; data: Buffer }): Attachment;
  listAttachments(jobId: number): Attachment[];
  attachmentFile(id: number): { attachment: Attachment; path: string; contentType: string };
}

export type DocumentsOptions = {
  repo: DocumentsRepo;
  bus: EventBus;
  now: Clock;
  ai: AiService;
  profile: ProfileService;
  jobs: JobsService;
  exporters: DocumentExporter[];
  // data/files: attachments live in a folder per job inside it.
  filesDir: string;
};

const KIND_LABEL: Record<DocumentKind, string> = { resume: 'Resume', cover_letter: 'Cover letter' };

export const TEMPLATE_FOR: Record<DocumentKind, ProfileFileName> = { resume: 'resume', cover_letter: 'cover-letter' };

export const NO_PROFILE = 'Add your master profile first: Settings → Profile.';

const GUIDE_FOR: Record<DocumentKind, ProfileFileName> = { resume: 'resume-guide', cover_letter: 'cover-letter-guide' };

const WORK_MODE: Record<Job['workMode'], string | null> = { onsite: 'On site', hybrid: 'Hybrid', remote: 'Remote', unknown: null };

// The job's details as plain text for the AI, leaving out what isn't known.
export function describeJob(job: Job): string {
  const list = (label: string, items: string[]) => (items.length > 0 ? [`${label}:`, ...items.map((i) => `- ${i}`)] : []);
  return [
    job.title && `Role: ${job.title}`,
    job.company && `Company: ${job.company}`,
    job.agency && `Recruiter: ${job.agency}`,
    job.location && `Location: ${job.location}`,
    WORK_MODE[job.workMode] && `Work mode: ${WORK_MODE[job.workMode]}`,
    job.summary && `Summary: ${job.summary}`,
    ...list('Requirements', job.requirements),
    ...list('Nice to have', job.niceToHave),
    ...list('Responsibilities', job.responsibilities),
  ]
    .filter(Boolean)
    .join('\n');
}

function cleanMarkdown(markdown: string): string {
  const text = markdown.replace(/\s+$/, '');
  if (!text.trim()) throw new ValidationError("A document can't be empty.");
  return text;
}

export function createDocumentsService(opts: DocumentsOptions): DocumentsService {
  const { repo, bus } = opts;

  function get(id: number): Document {
    const doc = repo.get(id);
    if (!doc) throw new NotFoundError(`Document ${id} not found`);
    return doc;
  }

  function insert(jobId: number, doc: { kind: DocumentKind; markdown: string; origin: Document['origin']; copiedFromId: number | null }): Document {
    opts.jobs.get(jobId);
    const saved = repo.insert({ jobId, ...doc, at: opts.now().toISOString() });
    bus.emit('document.saved', { jobId, documentId: saved.id });
    return saved;
  }

  // "Sam Taylor – Resume – Atlassian": the browser offers it as the PDF's file name.
  function titleOf(doc: Document): string {
    const name = /^#[ \t]+(.+?)[ \t#]*$/m.exec(opts.profile.read('master-profile') ?? '')?.[1]?.trim();
    const company = opts.jobs.get(doc.jobId).company;
    return [name, KIND_LABEL[doc.kind], company].filter(Boolean).join(' – ');
  }

  function pageInput(id: number) {
    const doc = get(id);
    const css = doc.isSent ? (doc.sentCss ?? '') : (opts.profile.read(TEMPLATE_FOR[doc.kind]) ?? '');
    return { title: titleOf(doc), markdown: doc.markdown, css };
  }

  // A stored path, resolved, and checked to be inside the job's own folder.
  function insideFiles(storedPath: string, jobId: number): string {
    const folder = resolve(opts.filesDir, String(jobId));
    const path = resolve(opts.filesDir, storedPath);
    if (!path.startsWith(folder + sep)) throw new ValidationError(WRONG_TYPE);
    return path;
  }

  return {
    list: (jobId) => repo.listForJob(jobId),

    listAll(kind) {
      const docs = repo.listAll(kind);
      const jobs = new Map(opts.jobs.getSummaries([...new Set(docs.map((d) => d.jobId))]).map((j) => [j.id, j]));
      return docs.map((d) => ({ ...d, jobTitle: jobs.get(d.jobId)?.title ?? null, company: jobs.get(d.jobId)?.company ?? null }));
    },

    get,

    saveVersion(jobId, req) {
      return insert(jobId, { kind: req.kind, markdown: cleanMarkdown(req.markdown), origin: req.origin, copiedFromId: null });
    },

    copyFrom(jobId, sourceId) {
      const source = get(sourceId);
      return insert(jobId, { kind: source.kind, markdown: source.markdown, origin: 'copied', copiedFromId: source.id });
    },

    markSent(id) {
      const doc = get(id);
      if (doc.isSent) return doc;
      const css = opts.profile.read(TEMPLATE_FOR[doc.kind]) ?? '';
      if (repo.markSent(id, css, opts.now().toISOString())) bus.emit('document.sent', { jobId: doc.jobId, documentId: id });
      return get(id);
    },

    latestSent(jobId) {
      return { resume: repo.latestSent(jobId, 'resume'), coverLetter: repo.latestSent(jobId, 'cover_letter') };
    },

    render(id) {
      const input = pageInput(id);
      return { title: input.title, html: documentPage(input) };
    },

    exporters: () => opts.exporters.map((e) => ({ id: e.id, label: e.label })),

    generate(jobId, kind, o) {
      const job = opts.jobs.get(jobId);
      const profile = opts.profile.read('master-profile');
      if (!profile) throw new ValidationError(NO_PROFILE);
      const ad = opts.jobs.listPostings(jobId)[0]?.jdText ?? '';
      const today = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }).format(opts.now());
      return opts.ai.writeDocument(
        { kind, profile, guide: opts.profile.read(GUIDE_FOR[kind]), job: describeJob(job), ad, today },
        // Generating again for the same document replaces the first try.
        { signal: o.signal, key: `doc-${jobId}-${kind}` },
      );
    },

    attach(jobId, file) {
      opts.jobs.get(jobId);
      const fileName = cleanFileName(file.fileName);
      if (!attachmentType(fileName)) throw new ValidationError(WRONG_TYPE);
      if (file.data.length > MAX_ATTACHMENT_BYTES) throw new ValidationError(TOO_BIG);
      const storedPath = `${jobId}/${randomBytes(4).toString('hex')}-${fileName}`;
      const path = insideFiles(storedPath, jobId);
      mkdirSync(join(opts.filesDir, String(jobId)), { recursive: true });
      // 'wx': never replaces a file that's already there.
      writeFileSync(path, file.data, { flag: 'wx' });
      let attachment: Attachment;
      try {
        attachment = repo.insertAttachment({
          jobId,
          kind: file.kind,
          fileName,
          storedPath,
          sizeBytes: file.data.length,
          at: opts.now().toISOString(),
        });
      } catch (err) {
        rmSync(path, { force: true });
        throw err;
      }
      bus.emit('attachment.added', { jobId, attachmentId: attachment.id });
      return attachment;
    },

    listAttachments: (jobId) => repo.listAttachments(jobId),

    attachmentFile(id) {
      const found = repo.getAttachment(id);
      if (!found) throw new NotFoundError(`Attachment ${id} not found`);
      const path = insideFiles(found.storedPath, found.attachment.jobId);
      if (!existsSync(path)) throw new NotFoundError(`The file ${found.attachment.fileName} is missing from data/files.`);
      return { attachment: found.attachment, path, contentType: attachmentType(found.attachment.fileName) ?? 'application/octet-stream' };
    },

    async export(id, format) {
      const exporter = opts.exporters.find((e) => e.id === format);
      if (!exporter) throw new ValidationError(`There's no export called ${format}.`);
      return exporter.export(pageInput(id));
    },
  };
}
