// Loads the extension's test build (extension/dist/chrome-e2e) into a fresh
// Chromium profile. Playwright can load extensions only in Chromium.

import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const extension = fileURLToPath(new URL('../../extension/dist/chrome-e2e', import.meta.url));

export const SITES = 'http://127.0.0.1:4798';

export const test = base.extend<{ context: BrowserContext; background: Worker; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    await use(context);
    await context.close();
  },
  background: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    await use(worker);
  },
  extensionId: async ({ background }, use) => {
    await use(background.url().split('/')[2]!);
  },
});

export { expect } from '@playwright/test';
