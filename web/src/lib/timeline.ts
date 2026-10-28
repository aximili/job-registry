// One list of everything that happened on a job, newest first.

import type { CallSheet, InteractionKind, SourceSite } from '../../../shared/contracts/index.ts';

export type TimelineItem = { at: string; kind: 'status' | 'note' | 'call' | 'ad'; text: string };

const KIND_LABEL: Record<InteractionKind, string> = { call: 'Call', email: 'Email', meeting: 'Meeting', message: 'Message' };
const SITE_NAME: Record<Exclude<SourceSite, 'pasted' | 'other'>, string> = { seek: 'Seek', linkedin: 'LinkedIn', indeed: 'Indeed' };

export function adSourceText(site: SourceSite): string {
  if (site === 'pasted') return 'Ad pasted in';
  if (site === 'other') return 'Ad saved from a website';
  return `Ad saved from ${SITE_NAME[site]}`;
}

export function buildTimeline(sheet: CallSheet, statusLabel: (id: string) => string = (id) => id): TimelineItem[] {
  const items: TimelineItem[] = [
    ...sheet.history.map((h) => ({
      at: h.changedAt,
      kind: 'status' as const,
      text: h.fromStatus ? `${statusLabel(h.fromStatus)} → ${statusLabel(h.toStatus)}` : statusLabel(h.toStatus),
    })),
    ...sheet.notes.map((n) => ({ at: n.createdAt, kind: 'note' as const, text: n.body })),
    ...sheet.interactions.map((i) => {
      const head = `${KIND_LABEL[i.kind]} with ${i.contactName ?? 'someone'}`;
      return { at: i.happenedAt, kind: 'call' as const, text: i.notes ? `${head}: ${i.notes}` : head };
    }),
    ...sheet.postings.map((p) => ({ at: p.capturedAt, kind: 'ad' as const, text: adSourceText(p.sourceSite) })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}
