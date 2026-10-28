import { describe, expect, it } from 'vitest';
import { attachmentType, cleanFileName } from './files.ts';

describe('cleanFileName', () => {
  it('keeps only the last part of a path, for both kinds of slash', () => {
    expect(cleanFileName('..\\..\\cv.pdf')).toBe('cv.pdf');
    expect(cleanFileName('../../etc/cv.pdf')).toBe('cv.pdf');
    expect(cleanFileName('C:\\Users\\Sam\\Documents\\cv.pdf')).toBe('cv.pdf');
  });

  it("drops characters Windows doesn't allow, and control characters", () => {
    expect(cleanFileName('my:cv*?"<>|.pdf')).toBe('mycv.pdf');
    expect(cleanFileName('cv\u0000\u001f.pdf')).toBe('cv.pdf');
    expect(cleanFileName('  cv.pdf. . ')).toBe('cv.pdf');
  });

  it('keeps emoji and accents', () => {
    expect(cleanFileName('🚀 résumé.pdf')).toBe('🚀 résumé.pdf');
  });

  it('renames Windows device names, with or without an extension', () => {
    expect(cleanFileName('CON.pdf')).toBe('_CON.pdf');
    expect(cleanFileName('nul')).toBe('_nul');
    expect(cleanFileName('com1.docx')).toBe('_com1.docx');
    expect(cleanFileName('CONTRACT.pdf')).toBe('CONTRACT.pdf');
  });

  it('cuts a long name to 100 characters, keeping the extension', () => {
    const name = cleanFileName(`${'a'.repeat(300)}.pdf`);
    expect(name).toHaveLength(100);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('gives "file" when nothing is left', () => {
    expect(cleanFileName('...')).toBe('file');
    expect(cleanFileName('\\')).toBe('file');
  });
});

describe('attachmentType', () => {
  it('knows PDF, Word, RTF, text and OpenDocument files by their extension, in any case', () => {
    expect(attachmentType('cv.PDF')).toBe('application/pdf');
    expect(attachmentType('cv.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(attachmentType('cv.doc')).toBe('application/msword');
    expect(attachmentType('cv.rtf')).toBe('application/rtf');
    expect(attachmentType('cv.txt')).toBe('text/plain; charset=utf-8');
    expect(attachmentType('cv.odt')).toBe('application/vnd.oasis.opendocument.text');
  });

  it('refuses anything else', () => {
    expect(attachmentType('evil.exe')).toBeNull();
    expect(attachmentType('cv.pdf.exe')).toBeNull();
    expect(attachmentType('noextension')).toBeNull();
  });
});
