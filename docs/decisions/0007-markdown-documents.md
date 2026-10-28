# 0007 — Resumes and cover letters as Markdown, printed to PDF

**Status:** Accepted (28 Oct 2026)

## Context
- You don't have Word, and you want to edit generated documents yourself before sending them.
- Small local models can't reliably write `.docx` files directly.
- Some Australian agencies ask for Word files.

## Decision
- **Format:** the AI writes Markdown, and you edit it as text with a live A4 preview, styled by `templates/*.css`.
- **PDF:** made with the browser's "Save to PDF".
- **Word:** an optional `.docx` export builds the file from the same Markdown with the `docx` library.
- **Keeping history:** each save adds a version. "Mark as sent" freezes the Markdown together with a copy of the CSS.

## Other options considered
- **A rich-text (WYSIWYG) editor.** Friendlier, but more code. Clean HTML is harder to store and diff, and harder to turn into `.docx`.
- **Word templates (docxtemplater).** Good Word output, but you can't edit inside the app, and you'd need an Office app for every change.

## Consequences
- No Office app is needed. Versions are small text rows, easy to compare.
- The layout depends on CSS, which is easy to change but needs a print-friendly template. A starter template is included.
- Free apps that open the `.docx` file: ONLYOFFICE Desktop Editors, Word for the web, LibreOffice.
