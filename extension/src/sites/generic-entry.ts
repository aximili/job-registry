// Injected by "Save this page" (the toolbar popup) into the tab you're on.
// It defines jobRegistryCapture(), which the background script then calls.

import { generic, pickExtractor } from './index.ts';

(globalThis as { jobRegistryCapture?: () => unknown }).jobRegistryCapture = () => {
  const url = new URL(location.href);
  // On a job site, its own reader knows the page best; otherwise the generic one.
  const site = pickExtractor(url);
  return site.extract(document, url, new Date()) ?? generic.extract(document, url, new Date());
};
