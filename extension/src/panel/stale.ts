// After the extension reloads or updates, Firefox runs the content script
// again in open tabs, and the old panel (with buttons that no longer work)
// would still be on the page. Remove it before adding a new one.

export function removeStalePanels(doc: Document): void {
  for (const old of Array.from(doc.querySelectorAll('job-registry-panel'))) old.remove();
}
