// The extension's background script: the only part that talks to the app.
// Firefox runs it as an event page, Chrome as a service worker.

import { createApiClient } from '../../shared/api-client.ts';
import { createHandlers, type ChromeLike } from './handlers.ts';
import type { Request } from './messages.ts';
import { HOST_ORIGINS, loadSettings } from './settings.ts';

const browser: ChromeLike = {
  async setBadge(tabId, text) {
    await chrome.action.setBadgeText({ tabId, text });
    if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2b44d1' });
  },
  async currentTabId() {
    // Usually the tab the popup opened over. If the popup is a window of its
    // own, the active tab in your browser window instead.
    const own = chrome.runtime.getURL('');
    const isPage = (tab: chrome.tabs.Tab) => tab.id !== undefined && !tab.url?.startsWith(own);
    const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (current && isPage(current)) return current.id!;
    const others = await chrome.tabs.query({ active: true, windowType: 'normal' });
    return others.find(isPage)?.id ?? null;
  },
  async runScript(tabId, files) {
    // The reader defines jobRegistryCapture(); a second call runs it and
    // brings back what it found. Both run in the extension's own world.
    await chrome.scripting.executeScript({ target: { tabId }, files });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (globalThis as { jobRegistryCapture?: () => unknown }).jobRegistryCapture?.() ?? null,
    });
    return result?.result ?? null;
  },
  async openTab(url) {
    await chrome.tabs.create({ url });
  },
  hasHostAccess: () => chrome.permissions.contains({ origins: HOST_ORIGINS }),
};

const handle = createHandlers({
  api: async () => createApiClient({ baseUrl: (await loadSettings()).serverUrl }),
  chrome: browser,
  serverUrl: async () => (await loadSettings()).serverUrl,
});

chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
  void handle(message, { tabId: sender.tab?.id ?? null }).then(sendResponse);
  return true; // the reply comes later
});
