// Phone numbers are stored and searched as plain digits.
// Australian international numbers are turned into their local form,
// so "+61 412 345 678" and "0412 345 678" match each other.

function localAustralian(digits: string, prefixLength: number): string {
  const rest = digits.slice(prefixLength);
  return rest.startsWith('0') ? rest : `0${rest}`;
}

export function phoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+61')) return localAustralian(digits, 2);
  if (digits.startsWith('0061')) return localAustralian(digits, 4);
  if (digits.length === 11 && digits.startsWith('61')) return localAustralian(digits, 2);
  return digits;
}

// Returns the digits to search for when a search box query looks like
// (part of) a phone number, or null when it doesn't.
export function queryDigits(q: string): string | null {
  if (!/^[\d\s+\-().]+$/.test(q)) return null;
  const raw = q.replace(/\D/g, '');
  let digits = raw;
  if (q.trim().startsWith('+61')) digits = localAustralian(raw, 2);
  else if (raw.startsWith('0061')) digits = localAustralian(raw, 4);
  // Count digits in local form: "+61 4" becomes "04", which every mobile starts with.
  return digits.length < 3 ? null : digits;
}
