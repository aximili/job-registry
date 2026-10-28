// Lets any part of the dashboard open the New job dialog, which lives in App.svelte.

let opener: ((text?: string) => void) | null = null;

export function registerNewJob(open: (text?: string) => void): () => void {
  opener = open;
  return () => {
    opener = null;
  };
}

export function openNewJob(text?: string): void {
  opener?.(text);
}

// A link, several lines, or a long paste is an ad. A name or phone number isn't.
export function looksLikeAd(text: string): boolean {
  const t = text.trim();
  return /^https?:\/\/\S+$/i.test(t) || t.includes('\n') || t.length > 120;
}
