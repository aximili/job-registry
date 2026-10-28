import { z } from 'zod';
import { Id, IsoDateTime } from './common.ts';

export const DocumentKind = z.enum(['resume', 'cover_letter']);
export type DocumentKind = z.infer<typeof DocumentKind>;

// How a version came to be: written by the AI, typed or edited by you, or
// copied from another version (often another job's).
export const DocumentOrigin = z.enum(['generated', 'edited', 'copied']);
export type DocumentOrigin = z.infer<typeof DocumentOrigin>;

export const DocumentSummary = z.object({
  id: Id,
  jobId: Id,
  kind: DocumentKind,
  version: z.number().int().positive(),
  origin: DocumentOrigin,
  copiedFromId: Id.nullable(),
  isSent: z.boolean(),
  sentAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

// sentCss is the template as it was when the version was sent, or null.
export const Document = DocumentSummary.extend({
  markdown: z.string(),
  sentCss: z.string().nullable(),
});
export type Document = z.infer<typeof Document>;

// For "Start from another job's version": which job each one belongs to.
export const DocumentListItem = DocumentSummary.extend({
  jobTitle: z.string().nullable(),
  company: z.string().nullable(),
});
export type DocumentListItem = z.infer<typeof DocumentListItem>;

export const MAX_DOCUMENT_LENGTH = 100_000;

export const SaveDocumentRequest = z.union([
  z.strictObject({
    kind: DocumentKind,
    markdown: z.string().max(MAX_DOCUMENT_LENGTH, 'That document is too long.'),
    origin: z.enum(['generated', 'edited']).default('edited'),
  }),
  z.strictObject({ fromDocumentId: Id }),
]);
export type SaveDocumentRequest = z.infer<typeof SaveDocumentRequest>;

export const ListDocumentsQuery = z.object({ kind: DocumentKind.optional() });

// The newest sent version of each kind, for the call sheet.
export const SentDocuments = z.object({
  resume: DocumentSummary.nullable(),
  coverLetter: DocumentSummary.nullable(),
});
export type SentDocuments = z.infer<typeof SentDocuments>;

// One button per way to export a document (architecture §6.4).
export const ExporterInfo = z.object({ id: z.string(), label: z.string() });
export type ExporterInfo = z.infer<typeof ExporterInfo>;

export const ExportQuery = z.object({ format: z.string().min(1) });

export const GenerateRequest = z.strictObject({ kind: DocumentKind });
export type GenerateRequest = z.infer<typeof GenerateRequest>;

// Generating streams one of these per line (NDJSON). The last line is "done",
// or "error" with a sentence to show, so a cut-off stream is never taken for
// a finished one.
export const GenerateChunk = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('done') }),
  z.object({ kind: z.literal('error'), message: z.string() }),
]);
export type GenerateChunk = z.infer<typeof GenerateChunk>;

export const AttachmentKind = z.enum(['resume', 'cover_letter', 'other']);
export type AttachmentKind = z.infer<typeof AttachmentKind>;

// A file you made elsewhere (a PDF or Word file), kept with the job.
export const Attachment = z.object({
  id: Id,
  jobId: Id,
  kind: AttachmentKind,
  fileName: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: IsoDateTime,
});
export type Attachment = z.infer<typeof Attachment>;

export const AttachQuery = z.object({ kind: AttachmentKind.default('other') });
