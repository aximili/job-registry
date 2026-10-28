import { z } from 'zod';
import { Id, LocalDate } from './common.ts';

// Snippets mark matched words with \u0001 (start) and \u0002 (end).
export const JobHit = z.object({
  kind: z.literal('job'),
  jobId: Id,
  title: z.string().nullable(),
  company: z.string().nullable(),
  agency: z.string().nullable(),
  status: z.string(),
  dateApplied: LocalDate.nullable(),
  snippet: z.string().nullable(),
});
export type JobHit = z.infer<typeof JobHit>;

export const ContactHit = z.object({
  kind: z.literal('contact'),
  contactId: Id,
  name: z.string(),
  organisation: z.string().nullable(),
  phone: z.string().nullable(),
  snippet: z.string().nullable(),
});
export type ContactHit = z.infer<typeof ContactHit>;

export const SearchHit = z.discriminatedUnion('kind', [JobHit, ContactHit]);
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchQuery = z.object({ q: z.string().max(200).default('') });
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchResponse = z.object({ hits: z.array(SearchHit) });
export type SearchResponse = z.infer<typeof SearchResponse>;

export const RebuildSearchResponse = z.object({
  jobs: z.number().int(),
  contacts: z.number().int(),
});
export type RebuildSearchResponse = z.infer<typeof RebuildSearchResponse>;
