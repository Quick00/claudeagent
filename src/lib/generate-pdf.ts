import { marked, type Token, type Tokens } from 'marked';
import pdfmake from 'pdfmake';
import Helvetica from 'pdfmake/standard-fonts/Helvetica';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

type Run = { text: string; bold?: boolean; italics?: boolean; decoration?: 'lineThrough' };
type Marks = Omit<Run, 'text'>;

// The built-in PDF font: nothing to load from disk or bundle. pdfmake checks font names
// against the local-file policy too, so the four Helvetica faces are the only "files" allowed;
// nothing in a generated document may point it at a URL or any other path.
const STANDARD_FACES = new Set<string>(Object.values(Helvetica.Helvetica));
pdfmake.setFonts(Helvetica);
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path: string) => STANDARD_FACES.has(path));

const decode = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e] ?? _);

/** Inline tokens to text runs. Links keep their text only; images keep their alt text. */
function inline(tokens: Token[] | undefined, marks: Marks = {}): Run[] {
  const runs: Run[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'strong':
        runs.push(...inline((token as Tokens.Strong).tokens, { ...marks, bold: true }));
        break;
      case 'em':
        runs.push(...inline((token as Tokens.Em).tokens, { ...marks, italics: true }));
        break;
      case 'del':
        runs.push(...inline((token as Tokens.Del).tokens, { ...marks, decoration: 'lineThrough' }));
        break;
      case 'link':
        runs.push(...inline((token as Tokens.Link).tokens, marks));
        break;
      case 'br':
        runs.push({ text: '\n', ...marks });
        break;
      case 'text':
        if ('tokens' in token && token.tokens?.length) runs.push(...inline(token.tokens, marks));
        else runs.push({ text: decode((token as Tokens.Text).text), ...marks });
        break;
      default:
        runs.push({ text: decode('text' in token && typeof token.text === 'string' ? token.text : token.raw), ...marks });
    }
  }
  return runs;
}

function listItem(item: Tokens.ListItem): Content {
  const blocks = blocksOf(item.tokens);
  return blocks.length === 1 ? blocks[0] : { stack: blocks };
}

function blocksOf(tokens: Token[]): Content[] {
  const out: Content[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'space':
        break;
      case 'heading': {
        const h = token as Tokens.Heading;
        out.push({ text: inline(h.tokens), style: `h${Math.min(h.depth, 3)}` });
        break;
      }
      case 'paragraph':
        out.push({ text: inline((token as Tokens.Paragraph).tokens), style: 'paragraph' });
        break;
      case 'text':
        out.push({ text: inline((token as Tokens.Text).tokens ?? [token]) });
        break;
      case 'list': {
        const list = token as Tokens.List;
        const items = list.items.map(listItem);
        out.push(list.ordered ? { ol: items, style: 'list' } : { ul: items, style: 'list' });
        break;
      }
      case 'table': {
        const table = token as Tokens.Table;
        const header = table.header.map((cell) => ({ text: inline(cell.tokens), style: 'tableHeader' }));
        const body = table.rows.map((row) => header.map((_, c) => ({ text: inline(row[c]?.tokens) })));
        out.push({ table: { headerRows: 1, widths: header.map(() => '*'), body: [header, ...body] }, layout: 'lightHorizontalLines', style: 'table' });
        break;
      }
      case 'blockquote':
        out.push({ stack: blocksOf((token as Tokens.Blockquote).tokens), margin: [12, 0, 0, 8], italics: true });
        break;
      case 'hr':
        out.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#999999' }], margin: [0, 6, 0, 10] });
        break;
      default:
        // Code blocks, raw HTML and anything else: shown as plain text, never interpreted.
        out.push({ text: decode('text' in token && typeof token.text === 'string' ? token.text : token.raw), style: 'paragraph' });
    }
  }
  return out;
}

export function markdownToPdfContent(markdown: string): Content[] {
  return blocksOf(marked.lexer(markdown, { gfm: true }));
}

export async function buildPdf(title: string | undefined, markdown: string): Promise<Buffer> {
  const content: Content[] = title ? [{ text: title, style: 'title' }] : [];
  content.push(...markdownToPdfContent(markdown));

  const doc: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 50, 40, 50],
    info: title ? { title } : undefined,
    defaultStyle: { font: 'Helvetica', fontSize: 10, lineHeight: 1.25 },
    content,
    footer: (page, pages) => ({ text: `${page} / ${pages}`, alignment: 'center', fontSize: 8, color: '#777777', margin: [0, 20, 0, 0] }),
    styles: {
      title: { fontSize: 18, bold: true, margin: [0, 0, 0, 12] },
      h1: { fontSize: 15, bold: true, margin: [0, 10, 0, 6] },
      h2: { fontSize: 13, bold: true, margin: [0, 8, 0, 4] },
      h3: { fontSize: 11, bold: true, margin: [0, 6, 0, 4] },
      paragraph: { margin: [0, 0, 0, 8] },
      list: { margin: [0, 0, 0, 8] },
      table: { margin: [0, 4, 0, 10] },
      tableHeader: { bold: true },
    },
  };

  const buffer = await pdfmake.createPdf(doc).getBuffer();
  return Buffer.from(buffer);
}
