import { z } from 'zod';
import { IsoDateTime } from './common.ts';
import { ParsedJob } from './parsed-job.ts';

export const SourceSite = z.enum(['seek', 'linkedin', 'indeed', 'other', 'pasted']);
export type SourceSite = z.infer<typeof SourceSite>;

// One job ad as it was found: from a page, a link or pasted text.
export const Capture = z.object({
  sourceUrl: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  sourceSite: SourceSite,
  externalId: z.string().nullable(),
  title: z.string().optional(),
  company: z.string().optional(),
  location: z.string().optional(),
  jdText: z.string(),
  structured: ParsedJob.partial().optional(),
  capturedAt: IsoDateTime,
});
export type Capture = z.infer<typeof Capture>;

export const CapturePreviewRequest = z.union([
  z.object({ url: z.url() }),
  z.object({ text: z.string().min(1) }),
]);
export type CapturePreviewRequest = z.infer<typeof CapturePreviewRequest>;

export const CapturePreviewResponse = z.object({
  capture: Capture,
  warning: z.string().nullable(),
});
export type CapturePreviewResponse = z.infer<typeof CapturePreviewResponse>;
