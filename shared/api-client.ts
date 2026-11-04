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
const BRIEF_CUT_OFF = 'The brief stopped before it was finished. Try again.';
const PLAN_CUT_OFF = 'The plan stopped before it was finished. Try again.';

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

  // keepalive: the browser finishes the request even if the page closes.
  async function send(method: string, path: string, body?: unknown, signal?: AbortSignal, keepalive = false): Promise<Response> {
    const headers: Record<string, string> = { ...opts.headers };
    // A file upload sets its own content type, with the form's boundary.
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
    const res = await doFetch(`${opts.baseUrl}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal,
      ...(keepalive ? { keepalive } : {}),
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
    keepalive = false,
  ): Promise<z.infer<S>> {
    const res = await send(method, path, body, signal, keepalive);
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

  // A task's lines as it's made: waiting, working (each with the AI's name),
  // then done or error. The server always ends with one of those two, so a
  // reply without one was cut off. An alive line only keeps a quiet reply
  // open, so it isn't passed on.
  async function* taskLines<S extends z.ZodType<{ kind: string }>>(
    schema: S,
    res: Response,
    cutOff: string,
  ): AsyncGenerator<Exclude<z.infer<S>, { kind: 'alive' }>> {
    let last: z.infer<S> | null = null;
    for await (const line of lines(schema, res)) {
      if (line.kind === 'alive') continue;
      last = line;
      yield line as Exclude<z.infer<S>, { kind: 'alive' }>;
    }
    if (last?.kind !== 'done' && last?.kind !== 'error') throw new ApiError('internal', res.status, cutOff);
  }

  async function callVoid(method: string, path: string): Promise<void> {
    await send(method, path);
  }

  // Use the new starter guide (the guide comes back), or keep yours (its state comes back).
  function starterAction(name: C.GuideName, action: 'use'): Promise<C.ProfileFile>;
  function starterAction(name: C.GuideName, action: 'keep'): Promise<C.StarterStatus>;
  function starterAction(name: C.GuideName, action: C.StarterAction): Promise<C.ProfileFile | C.StarterStatus> {
    const body = { action } satisfies C.StarterActionRequest;
    return action === 'use'
      ? call(C.ProfileFile, 'POST', `/profile/${name}/starter`, body)
      : call(C.StarterStatus, 'POST', `/profile/${name}/starter`, body);
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
    useAi: (id: string) => call(C.Settings, 'PUT', '/settings/ai/active', { id } satisfies C.UseAiRequest),
    // null means the AI in use writes.
    // A pick made just before the page closes still arrives.
    useWriter: (id: string | null) =>
      call(C.Settings, 'PUT', '/settings/ai/writer', { id } satisfies C.UseWriterRequest, undefined, true),
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
    // Any AI from Settings → AI, saved or not, with the key typed in the form. Nothing is saved.
    checkAi: (req: z.input<typeof C.AiCheckRequest>) => call(C.AiTestResult, 'POST', '/ai/check', req),
    aiModels: (req: z.input<typeof C.AiCheckRequest>) => call(C.AiModelsResult, 'POST', '/ai/models', req),
    rate: (req: z.input<typeof C.RateRequest>, o: { signal?: AbortSignal } = {}) =>
      call(C.RateResponse, 'POST', '/ratings', req, o.signal),
    rateCard: (req: z.input<typeof C.RateCardRequest>, o: { signal?: AbortSignal } = {}) =>
      call(C.RateCardResponse, 'POST', '/ratings/card', req, o.signal),
    lookupCards: (req: C.CardsLookupRequest, o: { signal?: AbortSignal } = {}) =>
      call(C.CardsLookupResponse, 'POST', '/ratings/cards/lookup', req, o.signal),
    ratingsStatus: () => call(C.RatingsStatus, 'GET', '/ratings/status'),
    reparseJob: (id: number) => call(C.Job, 'POST', `/jobs/${id}/reparse`, {}),

    getProfileFile: (name: C.ProfileFileName) => call(C.ProfileFile, 'GET', `/profile/${name}`),
    // updatedAt: the file's time when the editor loaded it (null for a missing
    // file), so a file changed since is refused, never saved over.
    putProfileFile: (name: C.ProfileFileName, text: string, updatedAt?: string | null) =>
      call(C.ProfileFile, 'PUT', `/profile/${name}`, { text, updatedAt } satisfies C.PutProfileRequest),
    starters: () => call(z.array(C.StarterStatus), 'GET', '/profile/starters'),
    starterAction,

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
    // brief: 'use' writes with the job's brief; left out, the server skips it.
    // briefId: the brief on screen, so a newer one is refused (409). Who's
    // writing comes first (waiting, working), then the text, then done or
    // error; a reply without one of those two was cut off.
    async *generateDocument(
      jobId: number,
      kind: C.DocumentKind,
      o: { signal?: AbortSignal; brief?: 'use' | 'skip'; briefId?: number } = {},
    ) {
      const body = { kind, brief: o.brief, briefId: o.briefId } satisfies z.input<typeof C.GenerateRequest>;
      yield* taskLines(C.GenerateChunk, await send('POST', `/jobs/${jobId}/documents/generate`, body, o.signal), CUT_OFF);
    },

    getBrief: (jobId: number) => call(C.BriefResponse, 'GET', `/jobs/${jobId}/brief`),
    // Waiting, working (with the AI's name), then done with the brief, or error.
    async *makeBrief(jobId: number, o: { signal?: AbortSignal } = {}) {
      yield* taskLines(C.BriefLine, await send('POST', `/jobs/${jobId}/brief`, {}, o.signal), BRIEF_CUT_OFF);
    },
    editBrief: (id: number, edits: z.input<typeof C.BriefEdits>) => call(C.Brief, 'PATCH', `/briefs/${id}`, edits),
    addAnswersToProfile: (id: number) => call(C.AddAnswersResponse, 'POST', `/briefs/${id}/answers-to-profile`, {}),

    // The job's prep plans, newest first.
    prepPlans: (jobId: number) => call(C.PrepPlansResponse, 'GET', `/jobs/${jobId}/prep`),
    // Waiting, working (with the AI's name), then done with the plan, or error.
    async *makePrepPlan(jobId: number, o: { signal?: AbortSignal } = {}) {
      yield* taskLines(C.PrepLine, await send('POST', `/jobs/${jobId}/prep`, {}, o.signal), PLAN_CUT_OFF);
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
