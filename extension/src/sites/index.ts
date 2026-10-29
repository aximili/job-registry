// The site extractors, tried in order. Adding a site means adding one file
// here, before generic (see docs/architecture.md §16).

import { generic } from './generic.ts';
import type { FoundCard, SiteExtractor } from './helpers.ts';
import { indeed } from './indeed.ts';
import { linkedin } from './linkedin.ts';
import { seek } from './seek.ts';

export type { FoundCard, SiteExtractor };

const SITES: SiteExtractor[] = [seek, linkedin, indeed];

export function pickExtractor(url: URL): SiteExtractor {
  return SITES.find((site) => site.matches(url)) ?? generic;
}

export { generic };
