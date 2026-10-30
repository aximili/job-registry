// Puts the panel on the page: an element of its own at the end of <body>,
// with a closed shadow root, so the site's CSS can't reach in and its
// scripts can't read the panel.

import { mount, unmount } from 'svelte';
import Panel from './Panel.svelte';
import { SHADOW_MODE } from './shadow.ts';
import { removeStalePanels } from './stale.ts';
import type { PanelActions, PanelView } from './types.ts';

export type { PanelActions, PanelView };

export function mountPanel(doc: Document, actions: PanelActions, initial: PanelView) {
  removeStalePanels(doc);
  const host = doc.createElement('job-registry-panel');
  // "all: initial" stops the page's styles being inherited; the panel sets its
  // own. The host takes no space: the panel inside places itself in the window.
  host.style.cssText = 'all: initial; position: fixed; left: 0; top: 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: SHADOW_MODE });
  (doc.body ?? doc.documentElement).append(host);
  const app = mount(Panel, { target: root, props: { actions } }) as unknown as {
    setView(view: PanelView): void;
    focusToggle(): Promise<void>;
  };
  app.setView(initial);
  // Esc inside the panel tucks it away (key presses inside reach the host).
  let minimised = initial.minimised;
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !minimised) {
      event.stopPropagation();
      actions.setMinimised(true);
      void app.focusToggle();
    }
  });
  return {
    show(view: PanelView) {
      minimised = view.minimised;
      app.setView(view);
    },
    destroy() {
      unmount(app as unknown as Record<string, unknown>);
      host.remove();
    },
  };
}
