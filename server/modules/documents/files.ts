// Attached files: which types are allowed, and a file name that's safe to
// store. A name never carries a path, so a file can only ever land in its
// job's own folder under data/files/.

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const TOO_BIG = 'That file is over 15 MB.';
export const WRONG_TYPE = 'Attach a PDF, Word or text file.';

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  rtf: 'application/rtf',
  txt: 'text/plain; charset=utf-8',
  odt: 'application/vnd.oasis.opendocument.text',
};

const MAX_NAME = 100;
// Names Windows keeps for devices, with any extension: "CON.pdf" can't be opened.
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// The content type for an allowed file, by its extension, or null.
export function attachmentType(fileName: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return ext ? (TYPES[ext] ?? null) : null;
}

export function cleanFileName(raw: string): string {
  let name = raw.split(/[\\/]/).pop() ?? '';
  name = name
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .trim()
    .replace(/[. ]+$/, '');
  if (!name) return 'file';
  if (DEVICE.test(name)) name = `_${name}`;
  if (name.length > MAX_NAME) {
    const ext = /\.[a-z0-9]{1,10}$/i.exec(name)?.[0] ?? '';
    // By characters, not UTF-16 units, so an emoji is never cut in half.
    const base = Array.from(name.slice(0, name.length - ext.length));
    while (base.join('').length + ext.length > MAX_NAME) base.pop();
    name = base.join('') + ext;
  }
  return name;
}
