// npm run ext:check -- PAGE.html URL
// Runs the extension's reader for URL on a page you saved from your browser,
// and prints what it found: the job, then the job cards in a search list.
// Use it when a site changes its layout.

import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { pickExtractor } from '../extension/src/sites/index.ts';

const [file, href] = process.argv.slice(2);
if (!file || !href) {
  console.error('Usage: npm run ext:check -- saved-page.html "https://au.seek.com/job/81234567"');
  process.exit(1);
}
const { document } = parseHTML(readFileSync(file, 'utf8'));
const url = new URL(href);
const site = pickExtractor(url);
const doc = document as unknown as Parameters<typeof site.extract>[0];
console.log(`Reader: ${site.id}`);
const jobId = site.currentJobId(url, doc);
console.log(`Job id:   ${jobId ?? '(none: is the job open on this page?)'}`);
const capture = site.extract(doc, url, new Date());
const cards = site.readCards(doc, url);
if (capture) {
  console.log(`Title:    ${capture.title ?? '(missing)'}`);
  console.log(`Company:  ${capture.company ?? '(missing)'}`);
  console.log(`Location: ${capture.location ?? '(missing)'}`);
  console.log(`Link:     ${capture.canonicalUrl}`);
  console.log(`Ad text:  ${capture.jdText.length} characters`);
  console.log('');
  console.log(capture.jdText.slice(0, 600) + (capture.jdText.length > 600 ? '\n…' : ''));
  // A search list with no job open isn't a problem: its cards follow.
} else if (jobId || cards.length === 0) {
  console.log("Found nothing: no ad text where the reader looks (or the page shows another job). The site's layout may have changed.");
}
console.log('');
console.log(`Cards: ${cards.length}`);
for (const { card } of cards) {
  console.log(`${card.externalId}  ${card.title} · ${card.company ?? '(missing)'} · ${card.location ?? '(missing)'}`);
}
