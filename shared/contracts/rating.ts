import { z } from 'zod';
import { Capture, SourceSite } from './capture.ts';

// How well a job ad fits you, from your master profile and preferences.
export const Verdict = z.enum(['strong', 'good', 'stretch', 'weak']);
export type Verdict = z.infer<typeof Verdict>;

// The AI writes the fields in this order. The reasons come first, so the
// verdict and score follow from them: a model asked for the score first
// gives nearly every job the same one.
export const Rating = z.object({
  why: z.array(z.string()).max(4),
  whyNot: z.array(z.string()).max(4),
  dealBreakers: z.array(z.string()),
  salaryNote: z.string().nullable(),
  verdict: Verdict,
  score: z.number().int().min(0).max(100),
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

// One job card in a search list, as the extension reads it. A card shows
// only part of the ad. text is everything else the card shows, as plain text.
export const JobCard = z.object({
  canonicalUrl: z.string().min(1).max(2000),
  sourceSite: SourceSite,
  externalId: z.string().max(200).nullable(),
  title: z.string().min(1).max(300),
  company: z.string().max(300).nullable(),
  location: z.string().max(300).nullable(),
  text: z.string().max(4000),
});
export type JobCard = z.infer<typeof JobCard>;

// A quick rating from a card alone. reason is one sentence, and comes
// first for the same reason as in Rating.
export const CardRating = z.object({
  reason: z.string(),
  verdict: Verdict,
  score: z.number().int().min(0).max(100),
});
export type CardRating = z.infer<typeof CardRating>;

// The mark a card gets: "full" from a job you opened and rated, "quick" from
// the card alone.
export const CardMark = z.object({
  kind: z.enum(['full', 'quick']),
  verdict: Verdict,
  score: z.number().int().min(0).max(100),
  reason: z.string().nullable(),
});
export type CardMark = z.infer<typeof CardMark>;

// key: "latest wins", as for RateRequest.
export const RateCardRequest = z.object({
  card: JobCard,
  key: z.string().min(1).max(100).optional(),
});
export type RateCardRequest = z.infer<typeof RateCardRequest>;

// rating is null when there's no master profile yet; reason says what to do.
export const RateCardResponse = z.object({
  rating: CardRating.nullable(),
  cached: z.boolean(),
  reason: z.string().nullable(),
});
export type RateCardResponse = z.infer<typeof RateCardResponse>;

// What's known about each card without the AI.
export const CardsLookupRequest = z.object({ cards: z.array(JobCard).min(1).max(100) });
export type CardsLookupRequest = z.infer<typeof CardsLookupRequest>;

// One result per card, in the same order: null when the card has no mark yet.
export const CardsLookupResponse = z.object({
  results: z.array(CardMark.nullable()),
  reason: z.string().nullable(),
});
export type CardsLookupResponse = z.infer<typeof CardsLookupResponse>;
