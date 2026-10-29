// "closed" keeps the job site's scripts from reading what Job Registry puts
// on its pages (your saved status, your match rating). Only the browser
// tests' build opens it, so the tests can look inside. The panel and the
// card marks both use this.

declare const __PANEL_SHADOW__: ShadowRootMode | undefined;

export const SHADOW_MODE: ShadowRootMode = typeof __PANEL_SHADOW__ === 'string' ? __PANEL_SHADOW__ : 'closed';
