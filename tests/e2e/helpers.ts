// Seeding helpers for the browser tests. They call the real API.

import type { APIRequestContext } from '@playwright/test';
import type { Interaction, Job } from '../../shared/contracts/index.ts';

export const ORIGIN = 'http://127.0.0.1:4799';
const headers = { origin: ORIGIN };

export async function reset(request: APIRequestContext): Promise<void> {
  const res = await request.post('/__test/reset', { headers });
  if (!res.ok()) throw new Error(`reset failed: ${res.status()}`);
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
