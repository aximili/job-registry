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
  const digits = q.replace(/\D/g, '');
  if (digits.length < 3) return null;
  if (q.trim().startsWith('+61')) return localAustralian(digits, 2);
  if (digits.startsWith('0061')) return localAustralian(digits, 4);
  return digits;
}
