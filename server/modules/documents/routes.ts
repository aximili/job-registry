import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import multipart from '@fastify/multipart';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import { AttachQuery, ExportQuery, GenerateRequest, ListDocumentsQuery, SaveDocumentRequest, type GenerateChunk } from '../../../shared/contracts/index.ts';
import { PAGE_CSP } from '../../../shared/document-page.ts';
import { AppError, ValidationError } from '../../core/errors.ts';
import { IdParams, parseOrThrow } from '../../core/http/validate.ts';
import { MAX_ATTACHMENT_BYTES, TOO_BIG } from './files.ts';
import type { DocumentsService } from './service.ts';

// A download's file name, for every browser: a plain ASCII fallback, and the
// real name encoded (RFC 6266).
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName
    .normalize('NFKD')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii || 'download'}"; filename*=UTF-8''${encoded}`;
}

const line = (chunk: GenerateChunk): string => `${JSON.stringify(chunk)}\n`;

// The draft as lines of JSON: text as it comes, then done, or error with
// a sentence to show. A reader that went away gets nothing more.
async function* ndjson(stream: AsyncIterable<string>, log: FastifyBaseLogger): AsyncIterable<string> {
  try {
    for await (const text of stream) yield line({ kind: 'text', text });
    yield line({ kind: 'done' });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return;
    if (!(err instanceof AppError)) log.error({ err }, 'Writing a document failed');
    const message = err instanceof AppError ? err.message : 'Something went wrong while writing. See the log for details.';
    yield line({ kind: 'error', message });
  }
}

export function documentsRoutes(service: DocumentsService): FastifyPluginAsync {
  return async (http) => {
    // File uploads, for attachments only: one file, 15 MB at most.
    await http.register(multipart, { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 4, parts: 5 } });

    http.post('/jobs/:id/attachments', async (req, reply) => {
      const { id } = parseOrThrow(IdParams, req.params);
      const { kind } = parseOrThrow(AttachQuery, req.query);
      if (!req.isMultipart()) throw new ValidationError('Send the file as a file upload.');
      const part = await req.file();
      if (!part) throw new ValidationError('Choose a file to attach.');
      let data: Buffer;
      try {
        data = await part.toBuffer();
      } catch (err) {
        if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new ValidationError(TOO_BIG);
        throw err;
      }
      return reply.status(201).send(service.attach(id, { kind, fileName: part.filename, data }));
    });

    http.get('/attachments/:id', async (req, reply) => {
      const { attachment, path, contentType } = service.attachmentFile(parseOrThrow(IdParams, req.params).id);
      return reply.type(contentType).header('content-disposition', attachmentDisposition(attachment.fileName)).send(createReadStream(path));
    });

    http.get('/jobs/:id/documents', async (req) => service.list(parseOrThrow(IdParams, req.params).id));

    http.post('/jobs/:id/documents', async (req, reply) => {
      const { id } = parseOrThrow(IdParams, req.params);
      const body = parseOrThrow(SaveDocumentRequest, req.body);
      const saved = 'fromDocumentId' in body ? service.copyFrom(id, body.fromDocumentId) : service.saveVersion(id, body);
      return reply.status(201).send(saved);
    });

    http.get('/documents/exporters', async () => service.exporters());

    // The print view: open it and use the browser's Save to PDF.
    http.get('/documents/:id/render', async (req, reply) => {
      const { html } = service.render(parseOrThrow(IdParams, req.params).id);
      return reply.type('text/html; charset=utf-8').header('content-security-policy', PAGE_CSP).send(html);
    });

    http.get('/documents/:id/export', async (req, reply) => {
      const { id } = parseOrThrow(IdParams, req.params);
      const file = await service.export(id, parseOrThrow(ExportQuery, req.query).format);
      return reply.type(file.contentType).header('content-disposition', attachmentDisposition(file.fileName)).send(file.body);
    });

    http.post('/jobs/:id/documents/generate', async (req, reply) => {
      const { id } = parseOrThrow(IdParams, req.params);
      const { kind } = parseOrThrow(GenerateRequest, req.body);
      // Closing the editor or pressing Stop ends the request, which stops the AI.
      const controller = new AbortController();
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) controller.abort();
      });
      const stream = service.generate(id, kind, { signal: controller.signal });
      return reply
        .type('application/x-ndjson; charset=utf-8')
        .header('cache-control', 'no-cache')
        .send(Readable.from(ndjson(stream, req.log), { objectMode: false }));
    });

    http.get('/documents', async (req) => service.listAll(parseOrThrow(ListDocumentsQuery, req.query).kind));
    http.get('/documents/:id', async (req) => service.get(parseOrThrow(IdParams, req.params).id));
    http.post('/documents/:id/sent', async (req) => service.markSent(parseOrThrow(IdParams, req.params).id));
  };
}
