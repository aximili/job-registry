// Each signed upload to addons.mozilla.org needs a new version number, even
// when Job Registry's own version hasn't changed. So signing adds a fourth
// number: minutes since the start of 2026, which only ever goes up.

const START = Date.UTC(2026, 0, 1);

export function signingVersion(base, now = new Date()) {
  const minutes = Math.max(0, Math.floor((now.getTime() - START) / 60_000));
  return `${base}.${minutes}`;
}
