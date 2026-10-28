// "Export .docx": builds a Word file from the same Markdown the preview shows,
// for agencies that ask for Word. Open it in Word for the web, ONLYOFFICE or
// LibreOffice. The template CSS doesn't apply: Word gets a plain, tidy layout
// (Calibri 11 on A4). Raw HTML in the Markdown becomes plain text.

import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  type ParagraphChild,
} from 'docx';
import { lexMarkdown, type Token, type Tokens } from '../../../../shared/markdown.ts';
import { fileNameFor, type DocumentExporter } from '../exporter.ts';

const SAFE_LINK = /^(https?:|mailto:)/i;
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;
// Twentieths of a point: A4 is 210 × 297 mm.
const A4 = { width: 11906, height: 16838 };
const MARGIN = 1020; // 18 mm

type Style = { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean };

function inline(tokens: Token[] | undefined, style: Style = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  const run = (text: string, s: Style = style) =>
    out.push(new TextRun({ text, bold: s.bold, italics: s.italics, strike: s.strike, font: s.code ? 'Consolas' : undefined }));
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'strong':
        out.push(...inline((token as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case 'em':
        out.push(...inline((token as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case 'del':
        out.push(...inline((token as Tokens.Del).tokens, { ...style, strike: true }));
        break;
      case 'codespan':
        run((token as Tokens.Codespan).text, { ...style, code: true });
        break;
      case 'br':
        out.push(new TextRun({ break: 1 }));
        break;
      case 'link': {
        const link = token as Tokens.Link;
        const children = inline(link.tokens, style);
        if (SAFE_LINK.test(link.href.trim())) out.push(new ExternalHyperlink({ link: link.href.trim(), children }));
        else out.push(...children);
        break;
      }
      case 'image':
        run((token as Tokens.Image).text);
        break;
      case 'text': {
        const text = token as Tokens.Text;
        if (text.tokens) out.push(...inline(text.tokens, style));
        else run(text.text);
        break;
      }
      default:
        // Raw HTML, escapes and anything else: as plain text.
        run('text' in token && typeof token.text === 'string' ? token.text : token.raw);
    }
  }
  return out;
}

function blocks(tokens: Token[], list: { ordered: boolean; level: number; instance: number } | null = null): Paragraph[] {
  const out: Paragraph[] = [];
  let lists = 0;
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const h = token as Tokens.Heading;
        out.push(new Paragraph({ heading: HEADINGS[Math.min(h.depth, 3) - 1], children: inline(h.tokens) }));
        break;
      }
      case 'paragraph':
      case 'text': {
        const t = token as Tokens.Paragraph | Tokens.Text;
        out.push(listParagraph(t.tokens ? inline(t.tokens) : [new TextRun(t.text)], list));
        break;
      }
      case 'list': {
        const l = token as Tokens.List;
        lists++;
        const level = list ? list.level + 1 : 0;
        const instance = (list?.instance ?? 0) * 100 + lists;
        for (const item of l.items) out.push(...blocks(item.tokens, { ordered: l.ordered, level, instance }));
        break;
      }
      case 'blockquote':
        out.push(...blocks((token as Tokens.Blockquote).tokens, list));
        break;
      case 'code':
        out.push(new Paragraph({ children: [new TextRun({ text: (token as Tokens.Code).text, font: 'Consolas' })] }));
        break;
      case 'hr':
        out.push(new Paragraph({ border: { bottom: { style: 'single', size: 6, color: 'BBBBBB', space: 1 } }, children: [] }));
        break;
      case 'space':
        break;
      case 'table': {
        const t = token as Tokens.Table;
        for (const row of [t.header, ...t.rows]) {
          out.push(new Paragraph({ children: row.flatMap((cell, i) => [...(i > 0 ? [new TextRun('\t')] : []), ...inline(cell.tokens)]) }));
        }
        break;
      }
      default:
        // Raw HTML blocks: as plain text, never as markup.
        out.push(new Paragraph({ children: [new TextRun(('text' in token && typeof token.text === 'string' ? token.text : token.raw).trim())] }));
    }
  }
  return out;
}

function listParagraph(children: ParagraphChild[], list: { ordered: boolean; level: number; instance: number } | null): Paragraph {
  if (!list) return new Paragraph({ children, spacing: { after: 120 } });
  if (list.ordered) return new Paragraph({ children, numbering: { reference: 'numbers', level: list.level, instance: list.instance } });
  return new Paragraph({ children, bullet: { level: list.level } });
}

const heading = (size: number) => ({ run: { font: 'Calibri', size, bold: true, color: '1D1D24' }, paragraph: { spacing: { before: 240, after: 80 } } });

export function createDocxExporter(): DocumentExporter {
  return {
    id: 'docx',
    label: 'Export .docx',
    async export(doc) {
      const file = new Document({
        title: doc.title,
        styles: {
          default: {
            document: { run: { font: 'Calibri', size: 22 } },
            heading1: heading(36),
            heading2: heading(26),
            heading3: heading(22),
          },
        },
        numbering: {
          config: [
            {
              reference: 'numbers',
              levels: [0, 1, 2].map((level) => ({
                level,
                format: LevelFormat.DECIMAL,
                text: `%${level + 1}.`,
                alignment: AlignmentType.START,
                style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
              })),
            },
          ],
        },
        sections: [
          {
            properties: { page: { size: A4, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
            children: blocks(lexMarkdown(doc.markdown)),
          },
        ],
      });
      return {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: fileNameFor(doc.title, 'docx'),
        body: await Packer.toBuffer(file),
      };
    },
  };
}
