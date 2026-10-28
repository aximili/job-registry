// The DocumentExporter port: turns a document into a file. Each exporter
// becomes one button in the editor. See docs/architecture.md §6.4.

export type ExportInput = { title: string; markdown: string; css: string };
export type ExportedFile = { contentType: string; fileName: string; body: Buffer | string };

export interface DocumentExporter {
  id: string;
  // Shown on the button.
  label: string;
  export(doc: ExportInput): Promise<ExportedFile>;
}

// A file name Windows accepts: none of \ / : * ? " < > |, and no trailing dots or spaces.
export function fileNameFor(title: string, extension: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/[. ]+$/, '').trim() || 'Document';
  return `${base}.${extension}`;
}
