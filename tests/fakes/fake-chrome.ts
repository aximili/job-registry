// The few browser-extension calls the background script makes, for tests:
// it records badges, injected scripts and opened tabs.

import type { Capture } from '../../shared/contracts/index.ts';

export class FakeChrome {
  badges = new Map<number, string>();
  injected: { tabId: number; files: string[] }[] = [];
  opened: string[] = [];
  activeTabId: number | null = 1;
  scriptResult: Capture | null = null;
  hostAccess = true;

  async hasHostAccess(): Promise<boolean> {
    return this.hostAccess;
  }

  async setBadge(tabId: number, text: string): Promise<void> {
    this.badges.set(tabId, text);
  }

  async currentTabId(): Promise<number | null> {
    return this.activeTabId;
  }

  async runScript(tabId: number, files: string[]): Promise<unknown> {
    this.injected.push({ tabId, files });
    return this.scriptResult;
  }

  async openTab(url: string): Promise<void> {
    this.opened.push(url);
  }
}
