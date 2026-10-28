// Words for resumes and cover letters on the job page, the call sheet and
// the editor.

import type { DocumentKind, DocumentOrigin, DocumentSummary, SentDocuments } from '../../../shared/contracts/index.ts';
import { shortDate } from '../../../shared/dates.ts';

export const KIND_LABEL: Record<DocumentKind, string> = { resume: 'Resume', cover_letter: 'Cover letter' };

const ORIGIN_LABEL: Record<DocumentOrigin, string> = { generated: 'written by the AI', edited: 'edited', copied: 'copied' };

// "Version 3 · edited · 28 Oct", or "Version 2 · sent 27 Oct".
export function versionLabel(d: DocumentSummary, now: Date = new Date()): string {
  if (d.isSent) return `Version ${d.version} · sent ${shortDate(d.sentAt, now)}`;
  return `Version ${d.version} · ${ORIGIN_LABEL[d.origin]} · ${shortDate(d.createdAt, now)}`;
}

// What was sent, one part per kind: "Resume v2 (27 Oct)".
export function sentParts(sent: SentDocuments, now: Date = new Date()): { id: number; label: string }[] {
  return [sent.resume, sent.coverLetter]
    .filter((d): d is DocumentSummary => d !== null)
    .map((d) => ({ id: d.id, label: `${KIND_LABEL[d.kind]} v${d.version} (${shortDate(d.sentAt, now)})` }));
}

// "Resume v2 (27 Oct) · Cover letter v1 (28 Oct)", or null when nothing was sent.
export function sentLine(sent: SentDocuments, now: Date = new Date()): string | null {
  const parts = sentParts(sent, now).map((p) => p.label);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// Where the editor keeps text you haven't saved yet, per job and kind.
export const draftKey = (jobId: number, kind: DocumentKind): string => `jr-draft:${jobId}:${kind}`;
