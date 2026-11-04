// A mailto: link as text. Seek shows a contact as "••••@example.com.au" and
// only the link holds the real address, so the address is kept. Plain code,
// shared by the extension's page reader and the server's HTML reader. Their
// tests share one table of cases (tests/fixtures/mailto-cases.ts).

// The address in a mailto: link, up to any "?", or null when it has no "@".
function mailtoAddress(href: string | null | undefined): string | null {
  const raw = href?.trim().match(/^mailto:([^?]*)/i)?.[1];
  if (raw === undefined) return null;
  let address = raw;
  try {
    address = decodeURIComponent(raw);
  } catch {
    // A bad %-code: keep the address as written.
  }
  address = address.trim();
  return address.includes('@') ? address : null;
}

// A link's text (`inner`, already read from its children) with the address of
// a mailto: link it hides in brackets after it: "••••@example.com.au
// (Alex@example.com.au)". Text that shows the address stays as it is. A link
// with no text (an icon) becomes the address, with a space each side so it
// doesn't run into the words around it. Any other link's text stays as it is.
export function linkText(inner: string, href: string | null | undefined): string {
  const address = mailtoAddress(href);
  if (!address) return inner;
  if (!inner.trim()) return ` ${address} `;
  if (inner.toLowerCase().includes(address.toLowerCase())) return inner;
  const end = inner.trimEnd().length;
  return `${inner.slice(0, end)} (${address})${inner.slice(end)}`;
}
