// A thin typed wrapper around fetch, shared by the dashboard and the extension.
// Every response is checked against its contract, so a server change that
// breaks the shape shows up as a clear error, not as odd behaviour later.

import { z } from 'zod';
import * as C from './contracts/index.ts';

export class ApiError extends Error {
  code: C.ErrorCode;
  status: number;

  constructor(code: C.ErrorCode, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const CUT_OFF = 'The AI stopped before the draft was finished. The text so far is still here. Try again.';

export type ApiClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

type Query = Record<string, string | number | boolean | undefined>;

function queryString(params: Query): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]): [string, string] => [key, String(value)]);
  return entries.length > 0 ? `?${new URLSearchParams(entries).toString()}` : '';
}

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);

  async function send(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { ...opts.headers };
    // A file upload sets its own content type, with the form's boundary.
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
    const res = await doFetch(`${opts.baseUrl}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await toApiError(res);
    return res;
  }

  async function call<S extends z.ZodType>(
    schema: S,
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<z.infer<S>> {
    const res = await send(method, path, body, signal);
    const parsed = schema.safeParse(await readJson(res));
    if (!parsed.success) throw new ApiError('internal', res.status, 'Unexpected response from the server.');
    return parsed.data;
  }

  // A reply of one JSON value per line, read as the lines arrive.
  async function* lines<S extends z.ZodType>(schema: S, res: Response): AsyncGenerator<z.infer<S>> {
    if (!res.body) return;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = '';
    let done = false;
    const parse = (text: string): z.infer<S> => {
      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        // checked below
      }
      const parsed = schema.safeParse(data);
      if (!parsed.success) throw new ApiError('internal', res.status, 'Unexpected response from the server.');
      return parsed.data;
    };
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) {
          done = true;
          break;
        }
        const value = next.value;
        pending += value;
        const parts = pending.split('\n');
        pending = parts.pop() ?? '';
        for (const part of parts) if (part.trim()) yield parse(part);
      }
      if (pending.trim()) yield parse(pending);
    } finally {
      // A reader that leaves early (or a bad line) ends the request, so the
      // server stops the AI instead of writing on to nobody.
      if (!done) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  async function callVoid(method: string, path: string): Promise<void> {
    await send(method, path);
  }

  return {
    health: (o: { signal?: AbortSignal } = {}) => call(C.Health, 'GET', '/health', undefined, o.signal),
    previewCapture: (req: C.CapturePreviewRequest) =>
      call(C.CapturePreviewResponse, 'POST', '/captures/preview', req),

    checkJob: (req: C.JobCheckRequest, o: { signal?: AbortSignal } = {}) =>
      call(C.JobCheckResponse, 'POST', '/jobs/check', req, o.signal),
    checkMany: (req: C.CheckManyRequest, o: { signal?: AbortSignal } = {}) =>
      call(C.CheckManyResponse, 'POST', '/jobs/check-many', req, o.signal),
    saveJob: (req: z.input<typeof C.SaveJobRequest>, o: { signal?: AbortSignal } = {}) =>
      call(C.SaveJobResponse, 'POST', '/jobs', req, o.signal),
    listJobs: (q: Partial<C.ListJobsQuery> = {}) => call(z.array(C.JobSummary), 'GET', `/jobs${queryString(q)}`),
    getJob: (id: number) => call(C.Job, 'GET', `/jobs/${id}`),
    updateJob: (id: number, patch: C.UpdateJobRequest) => call(C.Job, 'PATCH', `/jobs/${id}`, patch),
    changeStatus: (id: number, status: string) => call(C.Job, 'POST', `/jobs/${id}/status`, { status }),
    setFollowUp: (id: number, req: z.input<typeof C.SetFollowUpRequest>) => call(C.Job, 'PUT', `/jobs/${id}/follow-up`, req),
    followUps: () => call(C.FollowUpsResponse, 'GET', '/jobs/follow-ups'),
    addPosting: (id: number, capture: C.Capture) => call(C.Job, 'POST', `/jobs/${id}/postings`, { capture }),
    lookupPosting: (url: string) => call(C.PostingLookupResponse, 'GET', `/postings/lookup${queryString({ url })}`),
    getCallSheet: (id: number) => call(C.CallSheet, 'GET', `/jobs/${id}/callsheet`),

    search: (q: string, o: { signal?: AbortSignal } = {}) =>
      call(C.SearchResponse, 'GET', `/search${queryString({ q })}`, undefined, o.signal),
    rebuildSearch: () => call(C.RebuildSearchResponse, 'POST', '/search/rebuild'),

    listNotes: (jobId: number) => call(z.array(C.Note), 'GET', `/jobs/${jobId}/notes`),
    addNote: (jobId: number, body: string) => call(C.Note, 'POST', `/jobs/${jobId}/notes`, { body }),
    updateNote: (id: number, body: string) => call(C.Note, 'PATCH', `/notes/${id}`, { body }),
    deleteNote: (id: number) => callVoid('DELETE', `/notes/${id}`),

    listContacts: (q?: string) => call(z.array(C.Contact), 'GET', `/contacts${queryString({ q })}`),
    createContact: (req: C.CreateContactRequest) => call(C.Contact, 'POST', '/contacts', req),
    updateContact: (id: number, patch: C.UpdateContactRequest) => call(C.Contact, 'PATCH', `/contacts/${id}`, patch),
    linkContact: (jobId: number, req: z.input<typeof C.LinkContactRequest>) =>
      call(C.JobContact, 'POST', `/jobs/${jobId}/contacts`, req),
    unlinkContact: (jobId: number, contactId: number) => callVoid('DELETE', `/jobs/${jobId}/contacts/${contactId}`),
    logInteraction: (req: z.input<typeof C.LogInteractionRequest>) =>
      call(C.Interaction, 'POST', '/interactions', req),
    listInteractions: (jobId: number) => call(z.array(C.Interaction), 'GET', `/jobs/${jobId}/interactions`),

    getSettings: () => call(C.Settings, 'GET', '/settings'),
    updateSettings: (patch: z.input<typeof C.UpdateSettingsRequest>) =>
      call(C.Settings, 'PATCH', '/settings', patch),
    secretsStatus: () => call(C.SecretsStatus, 'GET', '/settings/secrets'),
    updateSecrets: (req: C.UpdateSecretsRequest) => call(C.SecretsStatus, 'PUT', '/settings/secrets', req),

    emailStatus: () => call(C.EmailStatus, 'GET', '/email/status'),
    checkEmail: () => call(C.EmailStatus, 'POST', '/email/check', {}),
    testEmail: () => call(C.EmailTestResult, 'POST', '/email/test', {}),
    emailSuggestions: () => call(z.array(C.EmailSuggestion), 'GET', '/email/suggestions'),
    confirmSuggestion: (id: number, req: C.ConfirmSuggestionRequest = {}) =>
      call(C.EmailSuggestion, 'POST', `/email/suggestions/${id}/confirm`, req),
    dismissSuggestion: (id: number) => call(C.EmailSuggestion, 'POST', `/email/suggestions/${id}/dismiss`, {}),
    backupNow: () => call(C.BackupResponse, 'POST', '/system/backup'),

    aiStatus: () => call(C.AiStatus, 'GET', '/ai/status'),
    testAi: () => call(C.AiTestResult, 'POST', '/ai/test', {}),
    rate: (req: z.input<typeof C.RateRequest>, o: { signal?: AbortSignal } = {}) =>
      call(C.RateResponse, 'POST', '/ratings', req, o.signal),
    rateCard: (req: z.input<typeof C.RateCardRequest>, o: { signal?: AbortSignal } = {}) =>
      call(C.RateCardResponse, 'POST', '/ratings/card', req, o.signal),
    lookupCards: (req: C.CardsLookupRequest, o: { signal?: AbortSignal } = {}) =>
      call(C.CardsLookupResponse, 'POST', '/ratings/cards/lookup', req, o.signal),
    ratingsStatus: () => call(C.RatingsStatus, 'GET', '/ratings/status'),
    reparseJob: (id: number) => call(C.Job, 'POST', `/jobs/${id}/reparse`, {}),

    getProfileFile: (name: C.ProfileFileName) => call(C.ProfileFile, 'GET', `/profile/${name}`),
    putProfileFile: (name: C.ProfileFileName, text: string) => call(C.ProfileFile, 'PUT', `/profile/${name}`, { text }),

    listDocuments: (jobId: number) => call(z.array(C.DocumentSummary), 'GET', `/jobs/${jobId}/documents`),
    listAllDocuments: (kind?: C.DocumentKind) => call(z.array(C.DocumentListItem), 'GET', `/documents${queryString({ kind })}`),
    getDocument: (id: number) => call(C.Document, 'GET', `/documents/${id}`),
    saveDocument: (jobId: number, req: z.input<typeof C.SaveDocumentRequest>) =>
      call(C.Document, 'POST', `/jobs/${jobId}/documents`, req),
    markSent: (id: number) => call(C.Document, 'POST', `/documents/${id}/sent`, {}),
    exporters: () => call(z.array(C.ExporterInfo), 'GET', '/documents/exporters'),
    attachFile(jobId: number, kind: C.AttachmentKind, file: Blob, name: string) {
      const form = new FormData();
      form.append('file', file, name);
      return call(C.Attachment, 'POST', `/jobs/${jobId}/attachments${queryString({ kind })}`, form);
    },
    async *generateDocument(jobId: number, kind: C.DocumentKind, o: { signal?: AbortSignal } = {}): AsyncGenerator<C.GenerateChunk> {
      const res = await send('POST', `/jobs/${jobId}/documents/generate`, { kind }, o.signal);
      let last: C.GenerateChunk | null = null;
      for await (const chunk of lines(C.GenerateChunk, res)) {
        last = chunk;
        yield chunk;
      }
      // The server always ends with done or error. Without one, the draft was cut off.
      if (last?.kind !== 'done' && last?.kind !== 'error') throw new ApiError('internal', res.status, CUT_OFF);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = C.ErrorBody.safeParse(await readJson(res));
  if (body.success) return new ApiError(body.data.error.code, res.status, body.data.error.message);
  return new ApiError('internal', res.status, `The server replied with an error (${res.status}).`);
}
