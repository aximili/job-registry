// npm run ext:check -- PAGE.html URL
// Runs the extension's reader for URL on a page you saved from your browser,
// and prints what it found. Use it when a site changes its layout.

import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { pickExtractor } from '../extension/src/sites/index.ts';

const [file, href] = process.argv.slice(2);
if (!file || !href) {
  console.error('Usage: npm run ext:check -- saved-page.html "https://www.seek.com.au/job/81234567"');
  process.exit(1);
}
const { document } = parseHTML(readFileSync(file, 'utf8'));
const url = new URL(href);
const site = pickExtractor(url);
const doc = document as unknown as Parameters<typeof site.extract>[0];
console.log(`Reader: ${site.id}`);
console.log(`Job id:   ${site.currentJobId(url, doc) ?? '(none: is the job open on this page?)'}`);
const capture = site.extract(doc, url, new Date());
if (!capture) {
  console.log("Found nothing: no ad text where the reader looks (or the page shows another job). The site's layout may have changed.");
  process.exit(0);
}
console.log(`Title:    ${capture.title ?? '(missing)'}`);
console.log(`Company:  ${capture.company ?? '(missing)'}`);
console.log(`Location: ${capture.location ?? '(missing)'}`);
console.log(`Link:     ${capture.canonicalUrl}`);
console.log(`Ad text:  ${capture.jdText.length} characters`);
console.log('');
console.log(capture.jdText.slice(0, 600) + (capture.jdText.length > 600 ? '\n…' : ''));
