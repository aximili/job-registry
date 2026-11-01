// Seeding helpers for the browser tests. They call the real API.

import type { APIRequestContext } from '@playwright/test';
import { activeAi, newSavedAi, type Interaction, type Job, type SavedAi, type Settings } from '../../shared/contracts/index.ts';

export const ORIGIN = 'http://127.0.0.1:4799';
const headers = { origin: ORIGIN };

export async function reset(request: APIRequestContext): Promise<void> {
  const res = await request.post('/__test/reset', { headers });
  if (!res.ok()) throw new Error(`reset failed: ${res.status()}`);
}

// The settings as saved, and the AI in use in them.
export async function savedSettings(request: APIRequestContext): Promise<{ settings: Settings; ai: SavedAi }> {
  const settings = (await (await request.get('/api/v1/settings')).json()) as Settings;
  return { settings, ai: activeAi(settings.ai) };
}

// A second saved AI, "Claude – mine", with a made-up key (or none, with
// null). The fake AI answers for it, so nothing reaches Anthropic. Returns its id.
export async function seedCloudAi(request: APIRequestContext, key: string | null = 'sk-ant-e2e-not-a-real-key'): Promise<string> {
  const { settings } = await savedSettings(request);
  const claude = newSavedAi(
    'anthropic',
    'Claude – mine',
    settings.ai.saved.map((one) => one.id),
  );
  const saved = await request.patch('/api/v1/settings', {
    headers,
    data: { ai: { active: settings.ai.active, saved: [...settings.ai.saved, claude] } },
  });
  if (!saved.ok()) throw new Error(`seedCloudAi failed: ${saved.status()} ${await saved.text()}`);
  if (key === null) return claude.id;
  const keyed = await request.put('/api/v1/settings/secrets', { headers, data: { aiKeys: { [claude.id]: key } } });
  if (!keyed.ok()) throw new Error(`seedCloudAi's key failed: ${keyed.status()}`);
  return claude.id;
}

export async function seedJob(
  request: APIRequestContext,
  f: { title?: string; company?: string; agency?: string; location?: string; status?: string; jdText?: string },
): Promise<Job> {
  const res = await request.post('/api/v1/jobs', {
    headers,
    data: {
      capture: {
        sourceUrl: null,
        canonicalUrl: null,
        sourceSite: 'pasted',
        externalId: null,
        jdText: f.jdText ?? 'An ad.',
        capturedAt: new Date().toISOString(),
      },
      fields: {
        ...(f.title !== undefined ? { title: f.title } : {}),
        ...(f.company !== undefined ? { company: f.company } : {}),
        ...(f.agency !== undefined ? { agency: f.agency } : {}),
        ...(f.location !== undefined ? { location: f.location } : {}),
      },
      ...(f.status ? { status: f.status } : {}),
      decision: 'new',
    },
  });
  if (!res.ok()) throw new Error(`seedJob failed: ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { job: Job }).job;
}

export async function seedCall(
  request: APIRequestContext,
  jobId: number,
  c: { name: string; phone?: string; notes?: string },
): Promise<Interaction> {
  const res = await request.post('/api/v1/interactions', {
    headers,
    data: { newContact: { name: c.name, ...(c.phone ? { phone: c.phone } : {}) }, jobId, notes: c.notes ?? '' },
  });
  if (!res.ok()) throw new Error(`seedCall failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as Interaction;
}

export async function patchJob(request: APIRequestContext, id: number, patch: Record<string, unknown>): Promise<Job> {
  const res = await request.patch(`/api/v1/jobs/${id}`, { headers, data: patch });
  if (!res.ok()) throw new Error(`patchJob failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as Job;
}

// How the fake AI behaves: "smart" reads the ad, "fail" can't be reached,
// "slow" takes 1.5 s, "bad" answers with something that never fits.
export async function setAiMode(request: APIRequestContext, mode: 'smart' | 'fail' | 'slow' | 'bad'): Promise<void> {
  const res = await request.post('/__test/ai', { headers, data: { mode } });
  if (!res.ok()) throw new Error(`setAiMode failed: ${res.status()}`);
}

export async function seedDocument(
  request: APIRequestContext,
  jobId: number,
  d: { kind?: 'resume' | 'cover_letter'; markdown: string; sent?: boolean },
): Promise<{ id: number; version: number }> {
  const res = await request.post(`/api/v1/jobs/${jobId}/documents`, {
    headers,
    data: { kind: d.kind ?? 'resume', markdown: d.markdown, origin: 'edited' },
  });
  if (!res.ok()) throw new Error(`seedDocument failed: ${res.status()} ${await res.text()}`);
  const doc = (await res.json()) as { id: number; version: number };
  if (d.sent) {
    const sent = await request.post(`/api/v1/documents/${doc.id}/sent`, { headers, data: {} });
    if (!sent.ok()) throw new Error(`markSent failed: ${sent.status()}`);
  }
  return doc;
}

export async function putProfileFile(request: APIRequestContext, name: string, text: string): Promise<void> {
  const res = await request.put(`/api/v1/profile/${name}`, { headers, data: { text } });
  if (!res.ok()) throw new Error(`putProfileFile failed: ${res.status()} ${await res.text()}`);
}
