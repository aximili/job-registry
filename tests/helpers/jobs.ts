// Small builders for job tests.

import type { Capture } from '../../shared/contracts/index.ts';

export const CAPTURED_AT = '2026-10-28T03:15:00.000Z';

export function pastedCapture(jdText = 'An ad for a role.', extra: Partial<Capture> = {}): Capture {
  return {
    sourceUrl: null,
    canonicalUrl: null,
    sourceSite: 'pasted',
    externalId: null,
    jdText,
    capturedAt: CAPTURED_AT,
    ...extra,
  };
}

export function seekCapture(id: string, extra: Partial<Capture> = {}): Capture {
  return {
    sourceUrl: `https://www.seek.com.au/job/${id}`,
    canonicalUrl: `https://www.seek.com.au/job/${id}`,
    sourceSite: 'seek',
    externalId: id,
    jdText: 'An ad on Seek.',
    capturedAt: CAPTURED_AT,
    ...extra,
  };
}
