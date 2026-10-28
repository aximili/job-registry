// Turns a pasted link or pasted text into a Capture. It owns no data.
// Seek, LinkedIn and Indeed often block apps from downloading their pages.
// When that happens, it says so plainly and asks for the ad text instead.

import type { Capture, CapturePreviewResponse, SourceSite } from '../../../shared/contracts/index.ts';
import { canonicalJobUrl } from '../../../shared/canonical-url.ts';
import type { Clock } from '../../core/config.ts';
import { ValidationError } from '../../core/errors.ts';
import { extractJobPosting } from './jsonld.ts';
import { normaliseText, readableText } from './text.ts';

export interface CaptureService {
  fromText(text: string): Capture;
  fromUrl(url: string): Promise<CapturePreviewResponse>;
}

const SITE_LABEL: Partial<Record<SourceSite, string>> = { seek: 'Seek', linkedin: 'LinkedIn', indeed: 'Indeed' };
const MIN_PAGE_TEXT = 200;
const FETCH_TIMEOUT_MS = 15_000;
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  'Accept-Language': 'en-AU,en;q=0.8',
  Accept: 'text/html,application/xhtml+xml',
};

export function blockedWarning(site: SourceSite): string {
  const who = SITE_LABEL[site] ?? 'That site';
  return `${who} didn't let the app download this page. Copy the ad text from your browser and paste it here instead.`;
}

export function createCaptureService(opts: { fetch?: typeof fetch; now: Clock }): CaptureService {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    fromText(text) {
      return {
        sourceUrl: null,
        canonicalUrl: null,
        sourceSite: 'pasted',
        externalId: null,
        jdText: normaliseText(text),
        capturedAt: opts.now().toISOString(),
      };
    },

    async fromUrl(url) {
      let canonical: ReturnType<typeof canonicalJobUrl>;
      try {
        canonical = canonicalJobUrl(url);
      } catch {
        throw new ValidationError("That doesn't look like a web link.");
      }
      const base: Capture = {
        sourceUrl: url,
        canonicalUrl: canonical.canonicalUrl,
        sourceSite: canonical.sourceSite,
        externalId: canonical.externalId,
        jdText: '',
        capturedAt: opts.now().toISOString(),
      };
      const blocked = { capture: base, warning: blockedWarning(canonical.sourceSite) };

      let html: string;
      try {
        const res = await doFetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) return blocked;
        html = await res.text();
      } catch {
        return blocked;
      }

      const posting = extractJobPosting(html);
      if (posting) {
        const { structured } = posting;
        return {
          capture: {
            ...base,
            ...(structured.title ? { title: structured.title } : {}),
            ...(structured.company ? { company: structured.company } : {}),
            ...(structured.location ? { location: structured.location } : {}),
            structured,
            jdText: posting.descriptionText ?? readableText(html).text,
          },
          warning: null,
        };
      }

      // No structured data: use the readable page text, unless it's too short
      // to be an ad (a sign-in or "are you human?" page).
      const page = readableText(html);
      if (page.text.length < MIN_PAGE_TEXT) return blocked;
      return { capture: { ...base, ...(page.title ? { title: page.title } : {}), jdText: page.text }, warning: null };
    },
  };
}
