// The extension's own settings, kept in the browser: where Job Registry is,
// and whether to rate jobs as you open them.

export type ExtensionSettings = { serverUrl: string; autoRate: boolean };

// The permission the extension needs to reach Job Registry on this computer.
export const HOST_ORIGINS = ['http://127.0.0.1/*', 'http://localhost/*'];

// Set at build time for the browser tests (port 4799); otherwise the app's default.
declare const __DEFAULT_SERVER__: string | undefined;

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  serverUrl: typeof __DEFAULT_SERVER__ === 'string' ? __DEFAULT_SERVER__ : 'http://127.0.0.1:4777',
  autoRate: true,
};

export function checkServerUrl(text: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = text.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) return { ok: false, error: 'Start the address with http://, for example http://127.0.0.1:4777' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "That doesn't look like an address, for example http://127.0.0.1:4777" };
  }
  // The extension may only reach this computer (its host permission says so).
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    return { ok: false, error: 'Job Registry runs on this computer, so the address must be http://127.0.0.1 or http://localhost.' };
  }
  return { ok: true, value: `${url.protocol}//${url.host}` };
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = (await chrome.storage.local.get(['serverUrl', 'autoRate'])) as Partial<ExtensionSettings>;
  const server = typeof stored.serverUrl === 'string' ? checkServerUrl(stored.serverUrl) : null;
  return {
    serverUrl: server?.ok ? server.value : DEFAULT_EXTENSION_SETTINGS.serverUrl,
    autoRate: typeof stored.autoRate === 'boolean' ? stored.autoRate : DEFAULT_EXTENSION_SETTINGS.autoRate,
  };
}

export async function saveSettings(patch: Partial<ExtensionSettings>): Promise<void> {
  await chrome.storage.local.set(patch);
}
