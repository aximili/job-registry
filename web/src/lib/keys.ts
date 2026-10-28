// Single-key shortcuts (/, N, L, S, E) must never fire while you're typing.
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (el as HTMLElement).isContentEditable;
}

// True when a plain key press (no Ctrl, Alt or Cmd) happened outside a text field.
export function isShortcut(event: KeyboardEvent, key: string): boolean {
  return (
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key.toLowerCase() === key.toLowerCase() &&
    !isTypingTarget(document.activeElement)
  );
}
