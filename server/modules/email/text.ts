// The part of an email worth giving the AI: your correspondent's new words,
// without the quoted history, tidied and kept short.

const LIMIT = 4000;
const QUOTE_START = [/^On .+wrote:\s*$/, /^-{2,}\s*Original Message\s*-{2,}\s*$/i, /^From: .+$/];
// A forwarded email is the part that matters, so it's kept, From line and all.
const FORWARD_START = [/^-{2,}\s*Forwarded message\s*-{2,}$/i, /^Begin forwarded message:?$/i];

export function emailText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];
  let forwarded = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (FORWARD_START.some((pattern) => pattern.test(trimmed))) forwarded = true;
    const quoteStart = QUOTE_START.some((pattern) => pattern.test(trimmed));
    if (quoteStart && !forwarded && kept.some((l) => l.trim())) break;
    if (trimmed.startsWith('>')) continue;
    kept.push(line.replace(/[\u00A0\u202F]/g, ' ').replace(/[ \t]+/g, ' ').trim());
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, LIMIT);
}
