// Company names written the same way, so "Atlassian Pty Ltd" in a job
// matches "Atlassian" in an ad or an email. Plain code, shared by the
// server's duplicate check and its email filter.

const COMPANY_SUFFIXES = new Set([
  'pty', 'ltd', 'limited', 'inc', 'llc', 'plc', 'corp', 'corporation', 'co', 'group', 'holdings', 'australia', 'aust',
]);

// Lower-case words, with accents dropped: "Café Réunion" → ["cafe", "reunion"].
export function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .match(/[a-z0-9]+/g) ?? []
  );
}

// "The Commonwealth Bank of Australia" → "commonwealth bank". "Atlassian Pty Ltd" → "atlassian".
export function normaliseCompany(name: string): string {
  let list = words(name);
  if (list[0] === 'the' && list.length > 1) list = list.slice(1);
  while (list.length > 1 && COMPANY_SUFFIXES.has(list.at(-1)!)) list.pop();
  while (list.length > 1 && (list.at(-1) === 'of' || list.at(-1) === 'and')) list.pop();
  return list.join(' ');
}

// The normalised name with no spaces, to compare with a web address: "Hays Recruitment" → "haysrecruitment".
export function compactCompany(name: string): string {
  return normaliseCompany(name).replace(/ /g, '');
}
