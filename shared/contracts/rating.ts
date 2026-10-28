import { z } from 'zod';
import { Capture } from './capture.ts';

// How well a job ad fits you, from your master profile and preferences.
export const Verdict = z.enum(['strong', 'good', 'stretch', 'weak']);
export type Verdict = z.infer<typeof Verdict>;

export const Rating = z.object({
  verdict: Verdict,
  score: z.number().int().min(0).max(100),
  why: z.array(z.string()).max(4),
  whyNot: z.array(z.string()).max(4),
  dealBreakers: z.array(z.string()),
  salaryNote: z.string().nullable(),
});
export type Rating = z.infer<typeof Rating>;

// key: "latest wins". A new rating with the same key (one per browser tab)
// cancels the older one.
export const RateRequest = z.object({
  capture: Capture,
  key: z.string().min(1).max(100).optional(),
});
export type RateRequest = z.infer<typeof RateRequest>;

// rating is null when there's no master profile yet; reason says what to do.
export const RateResponse = z.object({
  rating: Rating.nullable(),
  cached: z.boolean(),
  reason: z.string().nullable(),
});
export type RateResponse = z.infer<typeof RateResponse>;

export const RatingsStatus = z.object({ ready: z.boolean(), detail: z.string() });
export type RatingsStatus = z.infer<typeof RatingsStatus>;
