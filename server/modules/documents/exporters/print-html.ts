// "Save as HTML": the same A4 page as the print view, as a file.

import { documentPage } from '../../../../shared/document-page.ts';
import { fileNameFor, type DocumentExporter } from '../exporter.ts';

export function createPrintHtmlExporter(): DocumentExporter {
  return {
    id: 'print-html',
    label: 'Save as HTML',
    async export(doc) {
      return { contentType: 'text/html; charset=utf-8', fileName: fileNameFor(doc.title, 'html'), body: documentPage(doc) };
    },
  };
}
